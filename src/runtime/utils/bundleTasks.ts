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
        // Bundle the task file with Rollup
        const bundle = await rollup({
            input: taskPath,
            plugins: [
                // esbuild transforms TypeScript to JavaScript efficiently
                esbuild({
                    target: "es2020",
                    minify: false,
                    tsconfig: false,
                }),
                nodeResolve({
                    preferBuiltins: true,
                    extensions: [".ts", ".js", ".mjs", ".cjs"],
                    // Set the root directory to properly resolve relative imports
                    rootDir: dirname(taskPath),
                }),
            ],
            external: [
                // External packages that should not be bundled (Nuxt/Nitro runtime)
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
                // Suppress certain warnings
                if (warning.code === 'UNRESOLVED_IMPORT') return;
                if (warning.code === 'MISSING_EXPORT') return;
                warn(warning);
            },
        });

        // Generate the bundled code
        const { output } = await bundle.generate({
            format: "esm",
            sourcemap: false,
        });

        // Close the bundle
        await bundle.close();

        // Return the bundled code
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
            // task.path is relative to tasksDir (e.g., "notifications-daily-reminders.ts")
            const fullPath = join(tasksDir, task.path);

            // First, dynamically import the task to get its metadata
            const taskModule = await import(fullPath);

            if (!taskModule?.default?.meta) {
                console.warn(`Task ${task.name} has invalid format - missing meta`);
                continue;
            }

            // Bundle the task file with all its dependencies
            const bundledCode = await bundleTaskFile(fullPath, tasksDir);

            // Remove extension for module path
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
