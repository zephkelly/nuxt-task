import { moduleConfiguration } from "../../config";
import type { CronTaskOptions } from "../../task/types";
import CronExpressionParser from "../../expression/parser";
import type { ModuleOptions } from "../../../module";
import { executeTaskRun } from "../runs/executor";
import { getRunState } from "../runs/state";

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

export function defineTaskHandler<T = any>(
    definition: NuxtCronTaskDefinition<T>
) {
    let config: ModuleOptions | undefined = undefined;
    try {
        // @ts-ignore
        config = useRuntimeConfig().nuxtTask as ModuleOptions;
    } catch (error) {
        config = undefined;
    }

    // useRuntimeConfig() resolves fine but carries no nuxtTask key when the
    // module options have not been published into the runtime config, which
    // assigns undefined without throwing. Fall back on a missing key too,
    // otherwise native mode silently returns the custom handler shape.
    if (!config) {
        config = moduleConfiguration.getModuleOptions();
    }

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
    // recorded for this definition, else meta.name as a last resort.
    const resolveName = (name?: string): string =>
        name
        ?? (self.task && getRunState().definitionNames.get(self.task))
        ?? metaName;

    if (config?.experimental?.tasks) {
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
        async run(context: TaskContext) {
            return toRunResult(await runCustom(context));
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
