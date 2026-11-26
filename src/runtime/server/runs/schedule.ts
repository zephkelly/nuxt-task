import { Cron } from "croner";

import CronExpressionParser from "../../expression/parser";
import {
    computeNextRunTime,
    UnsatisfiableCronExpressionError,
} from "../../scheduler/nextRun";
import { moduleConfiguration } from "../../config";
import type { ModuleOptions } from "../../../module";

import { getRunState, type ExecutionMode } from "./state";
import { TaskNotFoundError } from "./errors";

/**
 * Next croner occurrence strictly after `from`, in the process time zone.
 * That is how Nitro's schedule runner builds its Cron instances (no timezone
 * option), so this predicts what native mode actually fires.
 *
 * @param {string} expression - Cron pattern croner accepts
 * @param {Date} from - Reference time
 * @returns {Date | null} The occurrence, or null when there is none
 */
export function cronerNextRun(expression: string, from: Date): Date | null {
    const cron = new Cron(expression, { paused: true });

    try {
        return cron.nextRun(from);
    } finally {
        cron.stop();
    }
}

// Widening look-back windows for the previous-occurrence search. A
// scheduled run starts moments after its tick, so the first window almost
// always answers in a handful of steps.
const LOOKBACK_WINDOWS_MS = [
    60_000,
    60 * 60_000,
    24 * 60 * 60_000,
    32 * 24 * 60 * 60_000,
    367 * 24 * 60 * 60_000,
    9 * 367 * 24 * 60 * 60_000,
];

// Allows for a timer that wakes a millisecond or two before its occurrence.
const EARLY_FIRE_TOLERANCE_MS = 50;

/**
 * Latest croner occurrence at or before `now`, in the process time zone.
 *
 * croner's own `previousRun()` only remembers the instance's last fire, so
 * this walks forward from a widening look-back window instead.
 *
 * @param {string} expression - Cron pattern croner accepts
 * @param {Date} [now] - Reference time
 * @returns {Date | null} The occurrence, or null when none is found
 */
export function cronerPreviousRun(
    expression: string,
    now: Date = new Date()
): Date | null {
    const cron = new Cron(expression, { paused: true });
    const limit = now.getTime() + EARLY_FIRE_TOLERANCE_MS;

    try {
        for (const windowMs of LOOKBACK_WINDOWS_MS) {
            let ref = new Date(limit - windowMs);
            let latest: Date | null = null;

            for (;;) {
                const next = cron.nextRun(ref);
                if (!next || next.getTime() > limit) break;
                latest = next;
                ref = next;
            }

            if (latest) return latest;
        }

        return null;
    } finally {
        cron.stop();
    }
}

/**
 * The zone the custom scheduler evaluates a task in: the module zone in
 * strict mode, otherwise the task's own zone, falling back to the module's.
 *
 * @param {ModuleOptions} moduleOptions - Effective module options
 * @param {unknown} taskTimezone - The task's `options.timezone`
 * @returns {string} IANA zone
 */
export function resolveCustomTimezone(
    moduleOptions: ModuleOptions,
    taskTimezone?: unknown
): string {
    const moduleZone = moduleOptions?.timezone?.type || "UTC";

    if (moduleOptions?.timezone?.strict) return moduleZone;

    return typeof taskTimezone === "string" && taskTimezone
        ? taskTimezone
        : moduleZone;
}

/**
 * Next occurrence by the custom scheduler's own rules (its parser, its
 * day-of-month AND day-of-week matching), in `timezone`.
 *
 * @param {string} expression - Five-field expression
 * @param {string} timezone - IANA zone
 * @param {Date} from - Reference time
 * @param {ModuleOptions} [moduleOptions] - Effective module options
 * @returns {Date | null} The occurrence, or null if it can never fire
 */
export function customNextRun(
    expression: string,
    timezone: string,
    from: Date,
    moduleOptions: ModuleOptions = moduleConfiguration.getModuleOptions()
): Date | null {
    const parsed = CronExpressionParser.parseCronExpression(
        expression,
        {
            timezone: { ...moduleOptions.timezone, type: timezone },
            validateTimezone: true,
        } as any,
        moduleOptions as any
    );

    try {
        return computeNextRunTime(parsed, expression, from);
    } catch (error) {
        if (error instanceof UnsatisfiableCronExpressionError) return null;
        throw error;
    }
}

/**
 * Whether a schedule is valid but can never fire (`0 0 30 2 *`). An invalid
 * expression is not parked; it is reported elsewhere. Never throws.
 *
 * @param {string | undefined} expression - The schedule
 * @param {ExecutionMode} mode - Which scheduler fires it
 * @param {string} [timezone] - Zone for custom mode
 * @param {ModuleOptions} [moduleOptions] - Effective module options
 * @returns {boolean} True when parked
 */
export function isScheduleParked(
    expression: string | undefined,
    mode: ExecutionMode,
    timezone?: string,
    moduleOptions?: ModuleOptions
): boolean {
    if (!expression) return false;

    try {
        if (mode === "native") {
            return cronerNextRun(expression, new Date()) === null;
        }

        const options = moduleOptions ?? moduleConfiguration.getModuleOptions();

        return customNextRun(
            expression,
            timezone ?? resolveCustomTimezone(options),
            new Date(),
            options
        ) === null;
    } catch {
        return false;
    }
}

function currentMode(): ExecutionMode {
    const state = getRunState();
    if (state.mode) return state.mode;

    return moduleConfiguration.getModuleOptions()?.experimental?.tasks
        ? "native"
        : "custom";
}

/**
 * When a task, or a bare cron expression, next fires after `from`.
 *
 * Follows the scheduler that actually fires tasks in the current mode:
 *
 * - Native mode: croner in the process time zone (set `TZ` to change it).
 *   `nuxtTask.timezone` and a task's `options.timezone` do not move native
 *   fire times; they only set `ctx.timezone`.
 * - Custom mode: the module's own scheduler, in the task's zone under the
 *   module's strict/flexible rules.
 *
 * A registered task name is looked up first; anything else is treated as an
 * expression. Returns null for an on-demand task or a parked schedule.
 *
 * @param {string} nameOrExpression - Task path name or cron expression
 * @param {Date} [from] - Reference time, default now
 * @returns {Date | null} The next fire time
 * @throws {TaskNotFoundError} For an unknown name that is not an expression
 */
export function nextRun(
    nameOrExpression: string,
    from: Date = new Date()
): Date | null {
    const state = getRunState();
    const mode = currentMode();
    const moduleOptions = moduleConfiguration.getModuleOptions();
    const task = state.registry?.find((t) => t.name === nameOrExpression);

    if (task) {
        if (!task.schedule || task.parked) return null;

        return mode === "native"
            ? cronerNextRun(task.schedule, from)
            : customNextRun(
                task.schedule,
                resolveCustomTimezone(moduleOptions, task.options.timezone),
                from,
                moduleOptions
            );
    }

    const expression = nameOrExpression.trim();

    // Task names never contain whitespace; expressions always do, apart
    // from croner's @-macros.
    if (!/\s/.test(expression) && !expression.startsWith("@")) {
        throw new TaskNotFoundError(nameOrExpression);
    }

    return mode === "native"
        ? cronerNextRun(expression, from)
        : customNextRun(
            expression,
            resolveCustomTimezone(moduleOptions),
            from,
            moduleOptions
        );
}
