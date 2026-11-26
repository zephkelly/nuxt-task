/**
 * Public types for run tracking. Everything here describes one process: the
 * open-run registry and the hooks are in memory and per process, so a
 * multi-instance deployment sees one registry per instance.
 */

export type TaskRunStatus =
    | "running"
    | "succeeded"
    | "failed"
    | "skipped"
    | "timed-out";

/**
 * How a run was started, decided by the call path and never by payload
 * contents.
 *
 * - `manual`: started through `triggerTask()`, started from inside another
 *   run, or a run of a task that has no schedule (nothing could have
 *   scheduled it).
 * - `schedule`: everything else. In native mode that is Nitro's schedule
 *   runner, and also any direct `runTask()` call or Nitro's dev
 *   `/_nitro/tasks/:name` route, which nuxt-task cannot tell apart from a
 *   scheduled fire. Route manual runs through `triggerTask()`.
 */
export type TaskTrigger = "schedule" | "manual";

export interface TaskRun {
    /** UUID, or the `runId` given to `triggerTask()`. */
    readonly runId: string;
    /** The task's path name, e.g. `notifications:daily-reminders`. */
    readonly name: string;
    /** The free-text `meta.name` from the task file. */
    readonly metaName: string | undefined;
    readonly trigger: TaskTrigger;
    /** Opaque string from `triggerTask()`, passed through untouched. */
    readonly triggeredBy: string | undefined;
    /** The cron occurrence a scheduled run belongs to; null when manual. */
    readonly scheduledFor: Date | null;
    readonly startedAt: Date;
    readonly finishedAt: Date | null;
    /** The current attempt, starting at 1. Retries belong to the same run. */
    readonly attempt: number;
    /** Attempts allowed: `maxRetries + 1`. */
    readonly maxAttempts: number;
    readonly status: TaskRunStatus;
    /**
     * A mutable bag for the app's own data (a trace id, counters). Whatever
     * is in it when the run ends reaches `task:run:finish`.
     */
    meta: Record<string, unknown>;
}

export interface TaskRunStartEvent {
    run: TaskRun;
}

export interface TaskRunAttemptFailedEvent {
    run: TaskRun;
    attempt: number;
    error: unknown;
    /** Delay before the next attempt starts. */
    retryInMs: number;
}

export interface TaskRunFinishEvent {
    run: TaskRun;
    status: Exclude<TaskRunStatus, "running">;
    /** The handler's raw return value, when it returned. */
    result: unknown;
    /** The error the run rethrew, when it failed or timed out. */
    error: unknown;
    durationMs: number;
}

export interface TaskInfo {
    /** Path name, the one `runTask` and `triggerTask` take. */
    name: string;
    metaName: string | undefined;
    description: string | undefined;
    /** The literal schedule, or undefined for an on-demand task. */
    schedule: string | undefined;
    /** Options written as literals in the task file. */
    options: Record<string, unknown>;
    /** True for a schedule that can never fire (`0 0 30 2 *`). */
    parked: boolean;
}

export interface TriggerTaskOptions {
    payload?: Record<string, any>;
    context?: Record<string, any>;
    /** Use your own id (for example a database row id). Defaults to a UUID. */
    runId?: string;
    /** Opaque string passed to hooks and never interpreted. */
    triggeredBy?: string;
    /**
     * What to do when the task already has an open run. `reject` (default)
     * throws `TaskAlreadyRunningError`; `join` waits on the open run and
     * ignores this call's payload.
     */
    ifRunning?: "reject" | "join";
    /**
     * `true` (default) resolves when the run finishes and rethrows its error.
     * `false` resolves as soon as the run has started.
     */
    wait?: boolean;
}

export interface TriggerTaskResult {
    runId: string;
    joined: boolean;
    /** The handler's raw return value, when `wait` is true. */
    result?: unknown;
}

export type TaskRunHooks = {
    "task:run:start": (event: TaskRunStartEvent) => void | Promise<void>;
    "task:run:attempt-failed": (
        event: TaskRunAttemptFailedEvent
    ) => void | Promise<void>;
    "task:run:finish": (event: TaskRunFinishEvent) => void | Promise<void>;
};

declare module "nitropack" {
    interface NitroRuntimeHooks extends TaskRunHooks {}
}

declare module "nitropack/types" {
    interface NitroRuntimeHooks extends TaskRunHooks {}
}
