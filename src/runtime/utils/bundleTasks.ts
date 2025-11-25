import { rollup } from "rollup";
import { nodeResolve } from "@rollup/plugin-node-resolve";
import esbuild from "rollup-plugin-esbuild";
import { join, dirname } from "pathe";
import { writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";

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

            // Bundle the task file first (this resolves all relative imports)
            const bundledCode = await bundleTaskFile(fullPath, tasksDir);

            // Write bundled code to a temporary file so we can import it to get metadata
            const tempFile = join(tmpdir(), `nuxt-task-${task.name}-${Date.now()}.mjs`);
            await writeFile(tempFile, bundledCode, 'utf-8');

            try {
                // Import the bundled file to get metadata
                const taskModule = await import(tempFile);

                if (!taskModule?.default?.meta) {
                    console.warn(`Task ${task.name} has invalid format - missing meta`);
                    await unlink(tempFile).catch(() => {});
                    continue;
                }

                const modulePath = task.path.replace(/\.[^/.]+$/, "");

                bundledTasks.push({
                    name: task.name,
                    path: modulePath,
                    code: bundledCode,
                    module: taskModule,
                });

                console.log(`✓ Bundled task: ${task.name}`);
            } finally {
                // Clean up temp file
                await unlink(tempFile).catch(() => {});
            }
        } catch (error) {
            console.warn(`Failed to bundle task ${task.name}:`, error);
        }
    }

    return bundledTasks;
}
