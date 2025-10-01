import { constants } from "node:fs";
import { access } from "node:fs/promises";
import {
    defineNuxtModule,
    addServerPlugin,
    createResolver,
    addImports,
    addServerImports,
    addTemplate,
    updateRuntimeConfig,
} from "@nuxt/kit";
import { join, resolve } from "pathe";

import { moduleConfiguration, DEFAULT_MODULE_OPTIONS } from "./runtime/config";

import { scanTasksDirectory } from "./runtime/utils/scanTasks";
import { loadTaskModules } from "./runtime/utils/loadTasks";

import type {
    FlexibleTimezoneOptions,
    StrictTimezoneOptions,
} from "./runtime/utils/timezone";

import type { StorageType } from "./runtime/storage";

export interface BaseModuleOptions {
    serverTasks?: boolean;
    clientTasks?: boolean;
    tasksDir?: string;
    experimental?: {
        tasks?: boolean;
    };
    storage?: {
        type?: StorageType;
        config?: Record<string, any>;
    };
}

export type ModuleOptions = BaseModuleOptions & {
    timezone: FlexibleTimezoneOptions | StrictTimezoneOptions;
};

export default defineNuxtModule<ModuleOptions>({
    meta: {
        name: "nuxt-task",
        configKey: "nuxtTask",
        compatibility: {
            nuxt: "^3.10.0 || ^4.0.0",
        },
    },
    defaults: DEFAULT_MODULE_OPTIONS,
    async setup(moduleOptions, nuxt) {
        const resolver = createResolver(import.meta.url);

        await setupModuleBasics(moduleOptions, nuxt, resolver);

        if (moduleOptions.experimental?.tasks) {
            await setupExperimentalTasks(moduleOptions, nuxt);
        } else {
            await setupCustomTasks(moduleOptions, nuxt);
        }

        if (import.meta.test) {
            console.log(
                "Skipping customer scheduler plugin in test environment"
            );
            return;
        }

        if (!moduleOptions.experimental?.tasks) {
            addServerPlugin(resolver.resolve("./runtime/plugin"));
        }

        nuxt.hook("nitro:build:before", () => {
            if (nuxt.options.dev) {
                if (!moduleOptions.experimental?.tasks) {
                    console.log(
                        "%c[ NUXT-TASK ]",
                        "color: black; background-color: rgb(9, 195, 81) font-weight: bold; font-size: 1.15rem;",
                        "🕒 Registering custom task scheduler"
                    );
                } else {
                    console.log(
                        "%c[ NUXT-TASK ]",
                        "color: black; background-color: rgb(9, 195, 81) font-weight: bold; font-size: 1.15rem;",
                        "🕒 Using native task scheduler"
                    );
                }
            }
        });
    },
});

async function setupModuleBasics(
    moduleOptions: ModuleOptions,
    nuxt: any,
    resolver: any
) {
    updateRuntimeConfig({
        nuxtTask: moduleOptions,
    });
    moduleConfiguration.setModuleOptions(moduleOptions);

    // Use absolute path and match the pattern that works in nuxt-frogger
    const runtimePath = resolver.resolve("./runtime");
    
    // Set up the alias with a subpath pattern
    nuxt.options.alias["#nuxt-task/imports"] = runtimePath;
    nuxt.options.alias["#tasks"] = join(nuxt.options.buildDir, "tasks.virtual");

    addServerImports([
        {
            name: "defineTaskHandler",
            as: "defineTaskHandler",
            from: resolver.resolve("./runtime/server/task/handler"),
        },
    ]);

    // @ts-ignore - Dont know how to add a type to the reference in this instance
    nuxt.hook("prepare:types", ({ references }) => {
        references.push({
            path: resolve(nuxt.options.buildDir, "types/nuxt-task.d.ts"),
        });
    });

    const runtimeDirs = [
        runtimePath,
        resolver.resolve("./runtime/task"),
        resolver.resolve("./runtime/server/task/handler"),
    ];

    nuxt.options.build = nuxt.options.build || {};
    nuxt.options.build.transpile = nuxt.options.build.transpile || [];
    nuxt.options.build.transpile.push(...runtimeDirs);
    
    // Also add the module itself to transpile
    nuxt.options.build.transpile.push('nuxt-task');
}

async function setupExperimentalTasks(moduleOptions: ModuleOptions, nuxt: any) {
    nuxt.hook("nitro:config", async (nitroConfig: any) => {
        const resolver = createResolver(import.meta.url);
        setupNitroBasics(nitroConfig, nuxt, resolver);

        nitroConfig.experimental = nitroConfig.experimental || {};
        nitroConfig.experimental.tasks = true;

        await configureNitroTasks(moduleOptions, nitroConfig, nuxt);
    });
}

async function setupCustomTasks(moduleOptions: ModuleOptions, nuxt: any) {
    nuxt.hook("nitro:config", async (nitroConfig: any) => {
        const resolver = createResolver(import.meta.url);
        setupNitroBasics(nitroConfig, nuxt, resolver);
        await setupVirtualTasksModule(nuxt, nitroConfig);
    });
}

function setupNitroBasics(nitroConfig: any, nuxt: any, resolver: any) {
    // Use absolute path consistently
    const runtimePath = resolver.resolve("./runtime");
    const typesPath = resolver.resolve("./runtime/types");

    nitroConfig.alias = nitroConfig.alias || {};
    nitroConfig.alias["#nuxt-task/server"] = runtimePath;

    nitroConfig.virtual = nitroConfig.virtual || {};
    nitroConfig.virtual["#nuxt-task/types"] = `export * from '${typesPath}'`;
    nitroConfig.virtual["#task-config"] = `export default ${JSON.stringify(
        nuxt.options.runtimeConfig.cron
    )}`;
}

async function setupVirtualTasksModule(nuxt: any, nitroConfig: any) {
    const tasksDir = join(nuxt.options.serverDir, "tasks");

    try {
        await access(tasksDir, constants.R_OK);
    } catch (error) {
        console.warn("No tasks directory found at:", tasksDir);
        return;
    }

    const virtualModule = await generateVirtualTasksModule(tasksDir);

    nitroConfig.virtual = nitroConfig.virtual || {};
    nitroConfig.virtual["#tasks"] = virtualModule;
}

async function generateVirtualTasksModule(tasksDir: string) {
    const tasks = await scanTasksDirectory(tasksDir);
    const loadedModules = await loadTaskModules(tasks, tasksDir);

    console.log(
        "🔄 Registering tasks:",
        loadedModules.map((task) => task.name)
    );

    return `
        ${loadedModules
            .map(
                (task) => {
                    // Ensure path has extension and use absolute path
                    const taskPath = join(tasksDir, task.path);
                    const pathWithExt = taskPath.endsWith('.ts') || taskPath.endsWith('.js') 
                        ? taskPath 
                        : `${taskPath}.ts`;
                    
                    return `import ${task.name.replace(/[:-]/g, "_")} from '${pathWithExt}'`;
                }
            )
            .join("\n")}

        export const taskDefinitions = [
            ${loadedModules
                .map((task) => task.name.replace(/[:-]/g, "_"))
                .join(",\n")}
        ]
    `;
}

export async function configureNitroTasks(
    options: ModuleOptions,
    nitroConfig: any,
    nuxt: any
) {
    if (!options.experimental?.tasks) return;

    nitroConfig.tasks = nitroConfig.tasks || {};
    nitroConfig.scheduledTasks = nitroConfig.scheduledTasks || [];
    nitroConfig.handlers = nitroConfig.handlers || {};

    try {
        const tasksDir = join(nuxt.options.serverDir, "tasks");

        try {
            await access(tasksDir, constants.R_OK);
        } catch (error) {
            console.warn("No tasks directory found at:", tasksDir);
            nitroConfig.tasks = {};
            return;
        }

        const tasks = await scanTasksDirectory(tasksDir);
        const loadedModules = await loadTaskModules(tasks, tasksDir);

        console.log(
            "🔄 Registering tasks:",
            loadedModules.map((task) => task.name)
        );

        const scheduledTasksMap = new Map<string, string[]>();

        for (const taskModule of loadedModules) {
            // Ensure path has extension
            const taskPath = taskModule.path.endsWith('.ts') || taskModule.path.endsWith('.js')
                ? taskModule.path
                : `${taskModule.path}.ts`;
            
            const fullTaskPath = join(tasksDir, taskPath);
            
            nitroConfig.tasks[taskModule.name] = {
                name: taskModule.name,
                description: taskModule.module.default.meta.description || "",
                handler: fullTaskPath,
            };

            if (taskModule.module.default.schedule) {
                const cronExpression = taskModule.module.default.schedule;
                const tasks = scheduledTasksMap.get(cronExpression) || [];
                tasks.push(taskModule.name);
                scheduledTasksMap.set(cronExpression, tasks);
            }

            // Register tasks as Nitro handlers
            nitroConfig.handlers[`/_nitro/tasks/${taskModule.name}`] = {
                method: "post",
                handler: fullTaskPath,
            };
        }

        const scheduledTasksObject = Array.from(
            scheduledTasksMap.entries()
        ).reduce((acc, [cron, tasks]) => {
            acc[cron] = tasks;
            return acc;
        }, {} as Record<string, string[]>);

        nitroConfig.scheduledTasks = scheduledTasksObject;

        nitroConfig.handlers["/_nitro/tasks"] = {
            method: "get",
            handler: {
                tasks: nitroConfig.tasks || {},
                scheduledTasks: scheduledTasksObject || [],
            },
        };
    } catch (error) {
        console.warn("Error configuring Nitro tasks:", error);
        nitroConfig.tasks = {};
    }
}