/**
 * Thrown by `triggerTask()` (with the default `ifRunning: 'reject'`) when the
 * task already has an open run in this process.
 */
export class TaskAlreadyRunningError extends Error {
    readonly taskName: string;
    /** The open run's id, when known. */
    readonly runId: string | undefined;

    constructor(taskName: string, runId?: string) {
        super(`Task "${taskName}" is already running.`);
        this.name = "TaskAlreadyRunningError";
        this.taskName = taskName;
        this.runId = runId;
    }
}

/** Thrown when a task name is not registered. */
export class TaskNotFoundError extends Error {
    readonly taskName: string;

    constructor(taskName: string) {
        super(`Task "${taskName}" is not registered.`);
        this.name = "TaskNotFoundError";
        this.taskName = taskName;
    }
}

/**
 * Thrown when an attempt exceeds `options.timeout`. The message stays
 * `task timeout`, as before, so existing checks on it keep working. The
 * handler is not cancelled: it keeps running after the run has closed.
 */
export class TaskTimeoutError extends Error {
    constructor() {
        super("task timeout");
        this.name = "TaskTimeoutError";
    }
}

/** Thrown when the run API is used before nuxt-task's server plugin ran. */
export class TaskRuntimeNotReadyError extends Error {
    constructor() {
        super(
            "nuxt-task's runtime is not ready. triggerTask() works only "
            + "inside the Nitro server, after nuxt-task's plugin has run."
        );
        this.name = "TaskRuntimeNotReadyError";
    }
}
