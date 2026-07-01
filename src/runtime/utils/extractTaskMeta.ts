import { readFile } from "node:fs/promises";
import { parseModule } from "magicast";

/**
 * Statically-extracted task metadata.
 *
 * Unlike the old approach, this never executes (or even imports) the task file,
 * so a task that imports aliased (`~/server/...`, `#imports`), relative, or
 * node_modules dependencies parses fine here — those imports are only resolved
 * later by Nitro's own build when it processes `handler: path`.
 */
export type TaskMetaInfo = {
    /** File-derived scan name (e.g. "db:migrate"). */
    name: string;
    /** Absolute path to the task file (already has an extension). */
    path: string;
    description: string;
    /** Undefined unless `schedule` is a static string literal in source. */
    schedule?: string;
};

/**
 * Parse a task file with magicast and read the literal `schedule`/`description`
 * from the default-exported `defineTaskHandler({ ... })` call. Parsing never
 * resolves imports, so this works for any import style a Nitro server file
 * supports. A non-literal (computed/imported) `schedule` cannot be known at
 * build time, so it is treated as on-demand-only with a warning.
 */
export async function extractTaskMeta(
    task: { name: string; path: string }
): Promise<TaskMetaInfo | null> {
    try {
        const mod = parseModule(await readFile(task.path, "utf-8"));
        const arg = mod.exports.default?.$args?.[0];

        if (!arg || !arg.meta) {
            console.warn(`Task ${task.name} has invalid format - missing meta`);
            return null;
        }

        const schedule
            = typeof arg.schedule === "string" ? arg.schedule : undefined;

        // `schedule` present in source but not a static string literal → we
        // can't know the cron string at build time, so register on-demand only.
        if (arg.schedule !== undefined && schedule === undefined) {
            console.warn(
                `Task ${task.name}: 'schedule' is not a static string literal; `
                + `registering as on-demand only (not scheduled). `
                + `Use a literal for build-time scheduling.`
            );
        }

        return {
            name: task.name,
            path: task.path,
            description:
                typeof arg.meta.description === "string"
                    ? arg.meta.description
                    : "",
            schedule,
        };
    } catch (error) {
        console.warn(`Failed to parse task ${task.name}:`, error);
        return null;
    }
}

/**
 * Extract metadata for a list of scanned task files, dropping any that are
 * malformed (missing `meta`) or unparseable.
 */
export async function extractTaskMetas(
    tasks: Array<{ name: string; path: string }>
): Promise<TaskMetaInfo[]> {
    const out: TaskMetaInfo[] = [];
    for (const task of tasks) {
        const info = await extractTaskMeta(task);
        if (info) out.push(info);
    }
    return out;
}
