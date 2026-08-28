import { moduleConfiguration } from "../../config";
import type { CronTaskOptions } from "../../task/types";
import CronExpressionParser from "../../expression/parser";
import type { ModuleOptions } from "../../../module";

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
 * Attempts allowed for one scheduled run: the initial attempt plus retries.
 * An unset `maxRetries` means a single attempt, and `maxRetries: 0` means
 * "do not retry", never "do not run".
 *
 * @param {number | undefined} maxRetries - Configured retry count
 * @returns {number} Attempts allowed, always at least one
 */
function resolveMaxAttempts(maxRetries?: number | null): number {
    if (maxRetries === undefined || maxRetries === null) {
        return 1;
    }

    return Math.max(0, maxRetries) + 1;
}

/**
 * Races a handler against its timeout, if one is configured.
 *
 * Only races when a timeout is set: racing against an already-resolved
 * promise would resolve every untimed task instantly, before its handler had
 * finished.
 *
 * @param {Promise<any>} execution - The in-flight handler promise
 * @param {number | undefined} timeout - Timeout in milliseconds
 * @returns {Promise<any>} The handler's result
 */
async function withTimeout(
    execution: Promise<any>,
    timeout?: number
): Promise<any> {
    if (!timeout) {
        return await execution;
    }

    let timer: ReturnType<typeof setTimeout> | undefined;

    try {
        return await Promise.race([
            execution,
            new Promise((_, reject) => {
                timer = setTimeout(
                    () => reject(new Error("task timeout")),
                    timeout
                );
            }),
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
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

    if (config?.experimental?.tasks) {
        return {
            ...baseTask,
            // Return the handler directly for Nitro tasks
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
                const options = definition.options || {};
                const maxAttempts = resolveMaxAttempts(options.maxRetries);
                let lastError: unknown;

                for (let attempt = 1; attempt <= maxAttempts; attempt++) {
                    try {
                        const result = await withTimeout(
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
                            options.timeout
                        );

                        return { success: true, ...result };
                    } catch (error) {
                        lastError = error;

                        if (attempt >= maxAttempts) break;

                        await new Promise((resolve) =>
                            setTimeout(resolve, options.retryDelay ?? 1000)
                        );
                    }
                }

                // Rethrow so Nitro records the run as failed. Resolving here
                // reported every failure to Nitro as a success and left
                // production with no failure signal at all.
                console.error(
                    `[ nuxt-task ] Task "${definition.meta?.name}" failed:`,
                    lastError
                );

                throw lastError instanceof Error
                    ? lastError
                    : new Error("Unknown error in task execution");
            },
        };
    }

    return {
        ...baseTask,
        async run(context: TaskContext) {
            try {
                CronExpressionParser.parseCronExpression(definition.schedule, {
                    timezone: config?.timezone,
                });
                const result = await definition.handler(context);
                return {
                    success: true,
                    ...result
                }
            }
            catch (error) {
                throw error instanceof Error
                    ? error
                    : new Error("Unknown error in task execution");
            }
        },
        _custom: {
            type: "nuxt-task",
            version: "1.0",
            virtual: true,
        },
    };
}
