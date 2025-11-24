import { rollup } from "rollup";
import { nodeResolve } from "@rollup/plugin-node-resolve";
import esbuild from "rollup-plugin-esbuild";
import { join, dirname } from "pathe";

export type BundledTask = {
    name: string;
    path: string;
    code: string;
    module: {
        default: {
            meta: {
                name?: string;
                description?: string;
            };
            schedule?: string;
        };
    };
};

/**
 * Bundle a task file with all its dependencies into a single module
 * This resolves the issue where task files can't use relative imports
 */
export async function bundleTaskFile(
    taskPath: string,
    tasksDir: string
): Promise<string> {
    try {
        const bundle = await rollup({
            input: taskPath,
            plugins: [
                esbuild({
                    target: "es2020",
                    minify: false,
                    tsconfig: false,
                }),
                nodeResolve({
                    preferBuiltins: true,
                    extensions: [".ts", ".js", ".mjs", ".cjs"],
                    rootDir: dirname(taskPath),
                }),
            ],
            external: [
                /^nuxt-task/,
                /^#nuxt-task/,
                /^nitropack/,
                /^h3/,
                /^@nuxt\//,
                /^nuxt$/,
                /^vue$/,
                /^node:/,
            ],
            treeshake: true,
            onwarn: (warning, warn) => {
                if (warning.code === 'UNRESOLVED_IMPORT') return;
                if (warning.code === 'MISSING_EXPORT') return;
                warn(warning);
            },
        });

        const { output } = await bundle.generate({
            format: "esm",
            sourcemap: false,
        });

        await bundle.close();

        return output[0].code;
    } catch (error) {
        console.error(`Failed to bundle task file ${taskPath}:`, error);
        throw error;
    }
}

/**
 * Bundle multiple task files
 */
export async function bundleTaskFiles(
    tasks: Array<{ name: string; path: string }>,
    tasksDir: string
): Promise<BundledTask[]> {
    const bundledTasks: BundledTask[] = [];

    for (const task of tasks) {
        try {
            const fullPath = join(tasksDir, task.path);

            const taskModule = await import(fullPath);

            if (!taskModule?.default?.meta) {
                console.warn(`Task ${task.name} has invalid format - missing meta`);
                continue;
            }

            const bundledCode = await bundleTaskFile(fullPath, tasksDir);

            const modulePath = task.path.replace(/\.[^/.]+$/, "");

            bundledTasks.push({
                name: task.name,
                path: modulePath,
                code: bundledCode,
                module: taskModule,
            });

            console.log(`✓ Bundled task: ${task.name}`);
        } catch (error) {
            console.warn(`Failed to bundle task ${task.name}:`, error);
        }
    }

    return bundledTasks;
}
