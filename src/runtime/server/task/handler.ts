// Deep path, as the native plugin uses: `nitropack/runtime` only exists from
// nitropack 2.10, and Nuxt 3.10 ships 2.8. Nitro does not auto-import into a
// dependency's code, so a bare useRuntimeConfig() here was a ReferenceError
// in every built app (1.3.0).
import { useRuntimeConfig } from "nitropack/dist/runtime/config";

import { moduleConfiguration } from "../../config";
import type { CronTaskOptions } from "../../task/types";
import CronExpressionParser from "../../expression/parser";
import type { ModuleOptions } from "../../../module";
import { executeTaskRun } from "../runs/executor";
import { getRunState, warnOnce } from "../runs/state";

export interface TaskContext {
    payload?: Record<string, any>;
    context?: Record<string, any>;
    [key: string]: any;
}

export interface TaskMeta {
    name: string;
    description?: string;
}

export interface NuxtCronTaskDefinition<T = any> {
    meta: TaskMeta;
    schedule: string;
    handler: (ctx: TaskContext) => Promise<T>;
    options?: Omit<CronTaskOptions, "expression"> & {
        timezone?: string;
    };
}

/**
 * Symbol-keyed entry the custom scheduler and the trigger adapter use to run
 * a definition with trusted inputs (its path name, the tick it belongs to)
 * that never travel through the handler's context argument.
 */
export const RUN_TASK_INTERNAL = Symbol.for("nuxt-task:run-internal");

export interface InternalRunInput {
    /** Path name. */
    name?: string;
    /** Set by the custom scheduler for a scheduled run. */
    scheduled?: { scheduledFor: Date | null };
}

/**
 * Keeps the long-standing `run()` return shape, `{ success: true, ...result }`,
 * which `runTask` callers read. Hooks and triggerTask() get the raw result.
 */
function toRunResult(result: any) {
    return { success: true, ...result };
}

/**
 * The module options from Nitro's runtime config, or undefined where they
 * cannot be read: outside Nitro, or when the key was never published.
 */
function readRuntimeModuleOptions(): ModuleOptions | undefined {
    try {
        const options = (useRuntimeConfig() as Record<string, any>)?.nuxtTask;
        return options && typeof options === "object"
            ? (options as ModuleOptions)
            : undefined;
    } catch {
        return undefined;
    }
}

/**
 * Which scheduler this definition belongs to, and the options it runs with.
 *
 * The scheduler that booted wins: nuxt-task's plugin attaches its mode
 * before Nitro loads a task module (native task chunks resolve lazily on
 * first run). Then the runtime config. The build-time module options are
 * a last resort, and saying so, because in a built app they hold only the
 * defaults and would pick the custom scheduler in native mode.
 */
function resolveHandlerMode(): { native: boolean; config: ModuleOptions } {
    const runtimeOptions = readRuntimeModuleOptions();
    const config = runtimeOptions ?? moduleConfiguration.getModuleOptions();
    const booted = getRunState().mode;

    if (booted) {
        return { native: booted === "native", config };
    }

    const native = Boolean(config?.experimental?.tasks);

    if (!runtimeOptions) {
        warnOnce(
            "handler:config-fallback",
            "[ nuxt-task ] Could not read `nuxtTask` from the runtime config, "
            + "and no nuxt-task plugin has started yet. Falling back to the "
            + `build-time module options, which select the ${native ? "native" : "custom"} `
            + "scheduler. If that is wrong, runs may be misnamed."
        );
    }

    return { native, config };
}

export function defineTaskHandler<T = any>(
    definition: NuxtCronTaskDefinition<T>
) {
    const { native, config } = resolveHandlerMode();

    const baseTask = {
        meta: {
            name: definition.meta?.name,
            description: definition.meta.description,
        },
        schedule: definition.schedule,
        options: definition.options || {},
    };

    const options = definition.options || {};
    const metaName = definition.meta?.name;

    // The object this call returns; the custom plugin records its path name
    // against it. A holder, because the methods are built before it exists.
    const self: { task?: object } = {};

    // Path name for a run: the caller's, else the one the custom plugin
    // recorded for this definition, else the build-time registry's entry
    // for this meta.name. meta.name itself only when no path name is known.
    const resolveName = (name?: string): string => {
        if (name) return name;

        const state = getRunState();
        const recorded = self.task && state.definitionNames.get(self.task);
        if (recorded) return recorded;

        const matches = (state.registry ?? []).filter(
            (t) => t.metaName === metaName
        );
        if (matches.length === 1) return matches[0]!.name;

        warnOnce(
            `handler:meta-name:${metaName}`,
            `[ nuxt-task ] No path name is known for the task with meta.name `
            + `"${metaName}", so its runs are named by meta.name. Run it through `
            + "Nitro's runTask, triggerTask() or nuxt-task's scheduler."
        );
        return metaName;
    };

    if (native) {
        const task = {
            ...baseTask,
            // Nitro's runTask calls this, from its schedule runner or from a
            // direct call, with the path name it registered the task under.
            async run({
                name,
                payload,
                context,
            }: {
                name?: string;
                payload?: Record<string, any>;
                context?: Record<string, any>;
                [key: string]: any;
            }) {
                // No cron validation here. Nitro schedules native tasks
                // with croner, which has already accepted this expression by
                // the time run() is reached. Re-checking it with the stricter
                // in-module parser rejects valid schedules (`0 0 * * 7`,
                // `@daily`, six-field) on every single fire, permanently.
                const result = await executeTaskRun({
                    name: resolveName(name),
                    metaName,
                    schedule: definition.schedule,
                    options,
                    invoke: () =>
                        definition.handler({
                            ...(context || {}),
                            ...(payload || {}),
                            // Trusted fields are pinned last so that a
                            // payload key cannot shadow them.
                            name: name,
                            timezone:
                                options.timezone
                                ?? config?.timezone?.type,
                        }),
                });

                return toRunResult(result);
            },
        };

        self.task = task;
        return task;
    }

    const task = {
        ...baseTask,
        // nuxt-task's scheduler and trigger adapter use RUN_TASK_INTERNAL.
        // This is reached by a direct call, or by Nitro's runTask, whose
        // event is `{ name, payload, context }` with the path name on it.
        async run(context: TaskContext) {
            const name = typeof context?.name === "string" && context.name
                ? context.name
                : undefined;
            return toRunResult(await runCustom(context, { name }));
        },
        _custom: {
            type: "nuxt-task",
            version: "1.0",
            virtual: true,
        },
    };

    // The context passes through to the handler untouched, as before; the
    // run's identity comes from `input`, never from the context.
    const runCustom = (context: TaskContext, input: InternalRunInput = {}) =>
        executeTaskRun({
            name: resolveName(input.name),
            metaName,
            schedule: definition.schedule,
            scheduled: input.scheduled,
            options,
            preflight: () => {
                CronExpressionParser.parseCronExpression(definition.schedule, {
                    timezone: config?.timezone,
                });
            },
            invoke: () => definition.handler(context),
        });

    // Non-enumerable, so spreading or comparing a definition is unchanged.
    Object.defineProperty(task, RUN_TASK_INTERNAL, {
        value: async (context: TaskContext, input: InternalRunInput) =>
            toRunResult(await runCustom(context, input)),
        enumerable: false,
    });

    self.task = task;
    return task;
}
