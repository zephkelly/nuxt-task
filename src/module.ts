import { constants } from "node:fs";
import { access } from "node:fs/promises";
import {
    defineNuxtModule,
    addServerPlugin,
    createResolver,
    addServerImports,
    updateRuntimeConfig,
} from "@nuxt/kit";
import { join, resolve } from "pathe";

import {
    moduleConfiguration,
    ModuleConfiguration,
    DEFAULT_MODULE_OPTIONS,
    RUNTIME_CONFIG_KEY,
} from "./runtime/config";

import { scanTasksDirectory } from "./runtime/utils/scanTasks";
import { extractTaskMetas } from "./runtime/utils/extractTaskMeta";
import type { TaskMetaInfo } from "./runtime/utils/extractTaskMeta";

import type {
    FlexibleTimezoneOptions,
    StrictTimezoneOptions,
} from "./runtime/utils/timezone";

import type { StorageType } from "./runtime/storage";
import type { TaskInfo } from "./runtime/server/runs/types";
import {
    isScheduleParked,
    resolveCustomTimezone,
} from "./runtime/server/runs/schedule";

/** The run API's exports, auto-imported in the server context. */
export const RUN_API_IMPORTS = [
    "triggerTask",
    "getCurrentTaskRun",
    "getRunningTasks",
    "isTaskRunning",
    "listTasks",
    "nextRun",
    "TaskAlreadyRunningError",
    "TaskNotFoundError",
] as const;

export interface BaseModuleOptions {
    serverTasks?: boolean;
    clientTasks?: boolean;
    tasksDir?: string;
    /**
     * Auto-import the run API (`triggerTask`, `listTasks`, `nextRun`, ...)
     * in the server context. Set false if the names clash with your own and
     * import from `nuxt-task/runtime` instead. Default true.
     */
    autoImports?: boolean;
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
            await setupExperimentalTasks(moduleOptions, nuxt, resolver);
        } else {
            await setupCustomTasks(moduleOptions, nuxt, resolver);
        }

        if (import.meta.test) {
            console.log(
                "Skipping custom scheduler plugin in test environment"
            );
            return;
        }

        if (!moduleOptions.experimental?.tasks) {
            addServerPlugin(resolver.resolve("./runtime/plugin"));
        } else {
            addServerPlugin(resolver.resolve("./runtime/server/plugins/native"));
        }

        nuxt.hook("nitro:build:before", () => {
            if (nuxt.options._prepare || nuxt.options._start) {
                return;
            }

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
    // Keyed by the shared constant so the publish site and the runtime read
    // site cannot drift apart again.
    updateRuntimeConfig({
        [RUNTIME_CONFIG_KEY]: moduleOptions,
    });
    moduleConfiguration.setModuleOptions(moduleOptions);

    // Warn, never throw: these checks are advisory, and a hard failure here
    // would break configurations that work today.
    if (!ModuleConfiguration.validateModuleOptions(moduleOptions)) {
        console.warn(
            "[ nuxt-task ] Module options look invalid. "
            + "The module will continue with the options as given."
        );
    }

    if (moduleOptions.clientTasks) {
        console.warn(
            "[ nuxt-task ] `clientTasks` is not implemented and has no "
            + "effect. It is deprecated and will be removed in a future "
            + "major release."
        );
    }

    // Set up aliases
    const runtimePath = resolver.resolve("./runtime");
    nuxt.options.alias["#nuxt-task"] = runtimePath;
    nuxt.options.alias["#tasks"] = join(nuxt.options.buildDir, "tasks.virtual");

    // defineTaskHandler is not auto-imported: import it from
    // "nuxt-task/handler" or "#nuxt-task". The run API is.
    const runApiPath = resolver.resolve("./runtime/server/runs/index");

    if (moduleOptions.autoImports !== false) {
        addServerImports(
            RUN_API_IMPORTS.map((name) => ({ name, from: runApiPath }))
        );
    }

    // Load the NitroRuntimeHooks augmentation into the server's types, so
    // `nitroApp.hooks.hook("task:run:finish", ...)` is typed without an
    // import.
    // @ts-ignore
    nuxt.hook("nitro:prepare:types", ({ references }) => {
        references.push({
            path: resolver.resolve("./runtime/server/runs/types"),
        });
    });

    // @ts-ignore
    nuxt.hook("prepare:types", ({ references }) => {
        references.push({
            path: resolve(nuxt.options.buildDir, "types/nuxt-task.d.ts"),
        });
    });

    // Transpile configuration
    nuxt.options.build = nuxt.options.build || {};
    nuxt.options.build.transpile = nuxt.options.build.transpile || [];
    nuxt.options.build.transpile.push("nuxt-task");
}

export async function setupExperimentalTasks(moduleOptions: ModuleOptions, nuxt: any, resolver: any) {
    nuxt.hook("nitro:config", async (nitroConfig: any) => {
        setupNitroBasics(nitroConfig, resolver);

        nitroConfig.experimental = nitroConfig.experimental || {};
        nitroConfig.experimental.tasks = true;

        // Configure Nitro's externals to ensure proper dependency tracing.
        // Tracing (vercel/nft) lets task files' node_modules dependencies
        // (including ones relying on Node globals like File/Blob) be traced
        // instead of bundled inline.
        nitroConfig.externals = nitroConfig.externals || {};

        // Only force NFT tracing for the production output. Nitro's dev preset
        // sets `externals.trace = false` on purpose: forcing it true makes
        // @vercel/nft trace the full node_modules graph of every task's imports
        // on each `nuxt dev` start — very slow with heavy imports and pointless
        // in dev (no traced .output is emitted). Production already traces
        // externals by default, so this only needs to be explicit for builds.
        if (!nuxt.options.dev) {
            nitroConfig.externals.trace = true;
        }

        await configureNitroTasks(moduleOptions, nitroConfig, nuxt);
    });
}

async function setupCustomTasks(moduleOptions: ModuleOptions, nuxt: any, resolver: any) {
    nuxt.hook("nitro:config", async (nitroConfig: any) => {
        setupNitroBasics(nitroConfig, resolver);
        await setupVirtualTasksModule(nuxt, nitroConfig, moduleOptions);
    });
}

function setupNitroBasics(nitroConfig: any, resolver: any) {
    // Use absolute path with .js extension for Nitro
    const runtimePath = resolver.resolve("./runtime");
    const typesPath = resolver.resolve("./runtime/types.js");

    nitroConfig.alias = nitroConfig.alias || {};
    nitroConfig.alias["#nuxt-task"] = runtimePath;

    nitroConfig.virtual = nitroConfig.virtual || {};
    nitroConfig.virtual["#nuxt-task/types"] = `export * from '${typesPath}'`;

    // Always present so the runtime plugins can import it; replaced with the
    // scanned registry once the tasks directory has been read.
    nitroConfig.virtual["#nuxt-task/registry"] = generateRegistryModule([]);
}

/**
 * Builds the runtime registry from statically extracted task metadata.
 * `parked` is decided by the scheduler that fires the task in this mode:
 * croner in native mode, the module's own calculator in custom mode.
 *
 * @param {TaskMetaInfo[]} taskMetas - Extracted metadata
 * @param {"native" | "custom"} mode - Execution mode
 * @param {ModuleOptions} options - Module options
 * @returns {TaskInfo[]} Registry entries
 */
export function buildTaskRegistry(
    taskMetas: TaskMetaInfo[],
    mode: "native" | "custom",
    options: ModuleOptions
): TaskInfo[] {
    return taskMetas.map((taskMeta) => {
        const taskOptions = taskMeta.options ?? {};

        return {
            name: taskMeta.name,
            metaName: taskMeta.metaName,
            description: taskMeta.description || undefined,
            schedule: taskMeta.schedule,
            options: taskOptions,
            parked: isScheduleParked(
                taskMeta.schedule,
                mode,
                mode === "custom"
                    ? resolveCustomTimezone(options, taskOptions.timezone)
                    : undefined,
                options
            ),
        };
    });
}

/**
 * @param {TaskInfo[]} entries - Registry entries
 * @returns {string} Source of the `#nuxt-task/registry` virtual module
 */
export function generateRegistryModule(entries: TaskInfo[]): string {
    return `export const taskRegistry = ${JSON.stringify(entries)};\n`;
}

/**
 * Resolves the directory task files are scanned from.
 *
 * `tasksDir` was declared on ModuleOptions and documented, but both execution
 * modes hard-coded `<serverDir>/tasks` and never read it. A relative value is
 * resolved against the server directory; an absolute one is used as given.
 *
 * @param {ModuleOptions} options - The module options
 * @param {any} nuxt - The Nuxt instance
 * @returns {string} Absolute path to the tasks directory
 */
export function resolveTasksDir(options: ModuleOptions, nuxt: any): string {
    if (options.tasksDir) {
        return resolve(nuxt.options.serverDir, options.tasksDir);
    }

    return join(nuxt.options.serverDir, "tasks");
}

async function setupVirtualTasksModule(
    nuxt: any,
    nitroConfig: any,
    options: ModuleOptions
) {
    const tasksDir = resolveTasksDir(options, nuxt);

    try {
        await access(tasksDir, constants.R_OK);
    } catch (error) {
        console.warn("No tasks directory found at:", tasksDir);
        return;
    }

    const virtualModule = await generateVirtualTasksModule(tasksDir);
    const taskMetas = await extractTaskMetas(
        await scanTasksDirectory(tasksDir)
    );

    nitroConfig.virtual = nitroConfig.virtual || {};
    nitroConfig.virtual["#tasks"] = virtualModule;
    nitroConfig.virtual["#nuxt-task/registry"] = generateRegistryModule(
        buildTaskRegistry(taskMetas, "custom", options)
    );
}

/**
 * Format the build/dev-time task registration log line.
 *
 * When more than 3 tasks are registered we collapse the list into a simple
 * "N tasks registered" count; otherwise we list the task names. The stand-out
 * parts (the count, or the task names) are printed in green ANSI colour.
 */
function formatTaskRegistrationMessage(taskNames: string[]) {
    const green = (text: string) => `\x1b[1;32m${text}\x1b[0m`;

    if (taskNames.length > 3) {
        return `🔄 ${green(`${taskNames.length} tasks registered`)}`;
    }

    return `🔄 Registering tasks: ${green(taskNames.join(", "))}`;
}

/**
 * Build the `#tasks` virtual module for custom-scheduler mode.
 *
 * Each scanned task file is statically imported by its absolute path, so
 * Nitro's own build resolves its aliases (`~`, `#imports`, ...), auto-imports,
 * relative imports and node_modules exactly like any other server file. The
 * previous approach bundled + executed task files in a bare Node context at
 * config time, which silently dropped any task with a non-trivial import.
 */
export async function generateVirtualTasksModule(tasksDir: string) {
    const tasks = await scanTasksDirectory(tasksDir);

    console.log(
        formatTaskRegistrationMessage(tasks.map((task) => task.name))
    );

    // scanTasksDirectory already returns absolute paths with extensions, so we
    // import them directly (no re-join). JSON.stringify safely quotes the path;
    // pathe yields POSIX separators so there is no Windows backslash issue.
    const imports = tasks
        .map((task, i) => `import task_${i} from ${JSON.stringify(task.path)};`)
        .join("\n");
    const list = tasks.map((_, i) => `task_${i}`).join(", ");
    // Path names, index-aligned with taskDefinitions, so the custom
    // scheduler registers and reports each task by the name runTask uses.
    const names = JSON.stringify(tasks.map((task) => task.name));

    return `${imports}\n\nexport const taskDefinitions = [${list}];\n`
        + `export const taskNames = ${names};\n`;
}

/**
 * Two task files can derive the same task name: `foo.ts` and `foo.js` both
 * scan to `foo`. Registration was last-write-wins, but the scheduled group
 * still received the name once per file, so Nitro ran the surviving handler
 * twice concurrently on every fire.
 *
 * Keeps the first file by sorted path so the winner is deterministic, and
 * warns naming both. Warns rather than throws: a throw here is swallowed by
 * configureNitroTasks' own catch, which silently disables every task.
 */
export function dedupeTaskMetas(taskMetas: TaskMetaInfo[]): TaskMetaInfo[] {
    const byName = new Map<string, TaskMetaInfo>();
    const sorted = [...taskMetas].sort((a, b) => a.path.localeCompare(b.path));

    for (const taskMeta of sorted) {
        const existing = byName.get(taskMeta.name);

        if (existing) {
            console.warn(
                `[ nuxt-task ] Duplicate task name "${taskMeta.name}": keeping `
                + `${existing.path}, ignoring ${taskMeta.path}. `
                + `Rename one of the files so each task name is unique.`
            );
            continue;
        }

        byName.set(taskMeta.name, taskMeta);
    }

    return Array.from(byName.values());
}

/**
 * Warn about schedules that can never fire (`0 0 30 2 *`) or that Nitro will
 * reject outright.
 *
 * Validates with croner, the library Nitro actually schedules with, and never
 * with this module's own parser: the parser is stricter than croner and would
 * warn about expressions that run perfectly well (`@daily`, `0 0 * * 7`,
 * six-field). Warns only, never throws.
 */
export async function warnUnschedulableTasks(taskMetas: TaskMetaInfo[]) {
    let Cron: any;

    try {
        ({ Cron } = await import("croner"));
    }
    catch (error) {
        // croner ships with Nitro. If it cannot be resolved, skip the check
        // rather than failing a build over a diagnostic.
        return;
    }

    for (const taskMeta of taskMetas) {
        if (!taskMeta.schedule) continue;

        try {
            const cron = new Cron(taskMeta.schedule, { paused: true });

            if (cron.nextRun() === null) {
                console.warn(
                    `[ nuxt-task ] Task "${taskMeta.name}" is scheduled `
                    + `"${taskMeta.schedule}", which will never run.`
                );
            }

            cron.stop();
        }
        catch (error) {
            console.warn(
                `[ nuxt-task ] Task "${taskMeta.name}" has an invalid schedule `
                + `"${taskMeta.schedule}": ${(error as Error).message}`
            );
        }
    }
}

export async function configureNitroTasks(
    options: ModuleOptions,
    nitroConfig: any,
    nuxt: any
) {
    if (!options.experimental?.tasks) return;

    nitroConfig.tasks = nitroConfig.tasks || {};
    nitroConfig.scheduledTasks = nitroConfig.scheduledTasks || [];

    try {
        const tasksDir = resolveTasksDir(options, nuxt);

        try {
            await access(tasksDir, constants.R_OK);
        } catch (error) {
            console.warn("No tasks directory found at:", tasksDir);
            nitroConfig.tasks = {};
            return;
        }

        const tasks = await scanTasksDirectory(tasksDir);
        // Read schedule/description statically (parse, don't execute) so task
        // files can use any import a Nitro server file supports. Nitro itself
        // builds `handler` below with full alias/auto-import resolution.
        const taskMetas = dedupeTaskMetas(await extractTaskMetas(tasks));

        console.log(
            formatTaskRegistrationMessage(taskMetas.map((task) => task.name))
        );

        await warnUnschedulableTasks(taskMetas);

        const scheduledTasksMap = new Map<string, string[]>();

        for (const taskMeta of taskMetas) {
            // scanTasksDirectory already yields an absolute path with extension.
            const fullTaskPath = taskMeta.path;

            nitroConfig.tasks[taskMeta.name] = {
                name: taskMeta.name,
                description: taskMeta.description,
                handler: fullTaskPath,
            };

            if (taskMeta.schedule) {
                const cronExpression = taskMeta.schedule;
                const tasks = scheduledTasksMap.get(cronExpression) || [];
                tasks.push(taskMeta.name);
                scheduledTasksMap.set(cronExpression, tasks);
            }
        }

        const scheduledTasksObject = Array.from(
            scheduledTasksMap.entries()
        ).reduce((acc, [cron, tasks]) => {
            acc[cron] = tasks;
            return acc;
        }, {} as Record<string, string[]>);

        nitroConfig.scheduledTasks = scheduledTasksObject;

        nitroConfig.virtual = nitroConfig.virtual || {};
        nitroConfig.virtual["#nuxt-task/registry"] = generateRegistryModule(
            buildTaskRegistry(taskMetas, "native", options)
        );
    } catch (error) {
        console.warn("Error configuring Nitro tasks:", error);
        nitroConfig.tasks = {};
    }
}