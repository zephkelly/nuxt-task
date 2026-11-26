import { EventEmitter } from "node:events";
import { DateTime } from "luxon";
import TimezoneUtils from "../utils/timezone";

import type {
    CronTask,
    CronTaskEvent,
    TaskId,
    CronTaskOptions,
    FlexibleCronTaskOptions,
} from "../task/types";
import type { CronStorage } from "../storage/types";

import type { ParsedExpression } from "../expression";
import CronExpressionParser from "../expression/parser";

import type { ModuleOptions } from "../../module";
import { moduleConfiguration } from "../config";
import type {
    SchedulerOptions,
    SchedulerStats,
    SchedulerBaseOptions,
} from "./types";
import { TaskQueue } from "./queue";
import {
    computeNextRunTime,
    MAX_NEXT_RUN_HORIZON_YEARS,
    UnsatisfiableCronExpressionError,
} from "./nextRun";

export { UnsatisfiableCronExpressionError } from "./nextRun";

/**
 * @class Scheduler
 * @extends EventEmitter
 * @description Main scheduler class that handles cron task execution and management
 *
 * @fires Scheduler#task-started - Emitted when a task starts execution
 * @fires Scheduler#task-completed - Emitted when a task completes successfully
 * @fires Scheduler#task-failed - Emitted when a task fails during execution
 * @fires Scheduler#task-retry - Emitted when a task is being retried
 * @fires Scheduler#task-paused - Emitted when a task is paused
 * @fires Scheduler#task-resumed - Emitted when a task is resumed
 * @fires Scheduler#error - Emitted when an error occurs in the scheduler
 */
export class Scheduler extends EventEmitter {
    /** How far ahead a next-run search looks; see `./nextRun`. */
    private static readonly MAX_NEXT_RUN_HORIZON_YEARS =
        MAX_NEXT_RUN_HORIZON_YEARS;

    private readonly options: SchedulerOptions;
    private queue: TaskQueue;
    private storage: CronStorage;
    private intervalId?: NodeJS.Timeout;
    private running: boolean = false;
    private startTime?: Date;
    private stats: SchedulerStats = {
        totalTasksRun: 0,
        totalTasksFailed: 0,
        totalTasksRetried: 0,
        activeTasks: 0,
        queuedTasks: 0,
        uptime: 0,
    };

    constructor(
        storage: CronStorage,
        moduleOptions: ModuleOptions,
        baseOptions: SchedulerBaseOptions = {}
    ) {
        super();
        if (
            moduleOptions.timezone?.validate &&
            !TimezoneUtils.isValidTimezone(moduleOptions.timezone)
        ) {
            throw new Error(`Invalid timezone: ${moduleOptions.timezone.type}`);
        }

        this.queue = new TaskQueue();
        this.storage = storage;

        this.options = {
            ...baseOptions,
            timezone: moduleOptions.timezone,
        };

        this.setupEventForwarding();
    }

    private setupEventForwarding(): void {
        type QueueEventType = CronTaskEvent["type"];
        type SchedulerEventType = `task-${QueueEventType}`;

        const eventMapping: Record<QueueEventType, SchedulerEventType> = {
            started: "task-started",
            completed: "task-completed",
            failed: "task-failed",
            retry: "task-retry",
            paused: "task-paused",
            resumed: "task-resumed",
        } as const;

        Object.entries(eventMapping).forEach(([queueEvent, schedulerEvent]) => {
            this.queue.on(
                queueEvent as QueueEventType,
                (event: CronTaskEvent) => {
                    switch (event.type) {
                        case "completed":
                            // nextRun is advanced by whichever path ran the
                            // task, so that a failed task is rescheduled too.
                            break;
                        case "failed":
                            this.stats.totalTasksFailed++;
                            break;
                        case "retry":
                            this.stats.totalTasksRetried++;
                            break;
                        case "started":
                            this.stats.totalTasksRun++;
                            break;
                    }
                    this.emit(schedulerEvent, event);
                }
            );
        });
    }

    /**
     * Handles and wraps errors with context
     *
     * @private
     * @param {string} method - The method where the error occurred
     * @param {unknown} error - The original error
     * @returns {Error} Wrapped error with context
     */
    /**
     * Emits an "error" event without crashing when nobody is listening.
     *
     * Node's EventEmitter rethrows an unhandled "error" event, so emitting
     * one from an internal failure path turned a recoverable problem into an
     * unhandled throw for any consumer that had not attached a listener.
     *
     * @protected
     * @param {Error} error - The error to report
     */
    protected emitError(error: Error): void {
        if (this.listenerCount("error") > 0) {
            this.emit("error", error);
            return;
        }

        console.error("[ nuxt-task ] Scheduler error:", error);
    }

    protected handleError(method: string, error: unknown): Error {
        if (error instanceof Error) {
            return new Error(`${method}: ${error.message}`);
        }
        return new Error(`${method}: An unknown error occurred`);
    }

    /**
     * Starts the scheduler
     *
     * @throws {Error} If the scheduler fails to start
     * @returns {Promise<void>}
     */
    async start(): Promise<void> {
        if (this.running) return;

        try {
            await this.storage.init();
            await this.restore();

            this.running = true;
            this.startTime = new Date();
            this.intervalId = setInterval(
                () => this.tick(),
                this.options.tickInterval
            );

            if (this.options.handleMissedTasks) {
                await this.handleMissedTasks();
            }
        } catch (error: unknown) {
            const wrappedError = this.handleError(
                "Failed to start scheduler",
                error
            );
            this.emitError(wrappedError);
            throw wrappedError;
        }
    }

    /**
     * Stops the scheduler
     *
     * @throws {Error} If the scheduler fails to stop
     * @returns {Promise<void>}
     */
    async stop(): Promise<void> {
        if (!this.running) return;

        try {
            this.running = false;
            if (this.intervalId) {
                clearInterval(this.intervalId);
            }

            const activeTask = this.queue
                .getAll()
                .filter((task) => task.status === "running");

            if (activeTask.length > 0) {
                await Promise.all(
                    activeTask.map((task) => this.waitForTask(task.id))
                );
            }

            await this.persist();
        } catch (error: unknown) {
            const wrappedError = this.handleError(
                "Failed to stop scheduler",
                error
            );
            this.emitError(wrappedError);
            throw wrappedError;
        }
    }

    /**
     * Get the active timezone for a task
     * @param {ModuleOptions} moduleOptions - The module options
     * @param {CronTaskOptions} taskOptions - The task options
     * @returns {Zone} - The active Luxon timezone
     * @throws {Error} If the timezone is invalid
     */
    public getActiveTimezone(taskOptions: CronTaskOptions): string {
        const moduleOptions = moduleConfiguration.getModuleOptions();

        // Strict enforcement used to be skipped whenever process.env.VITEST
        // was set, which meant the tests exercised different behaviour from
        // production and never covered this branch at all.
        if (moduleOptions.timezone.strict) {
            const globalTimezone = moduleOptions.timezone.type;

            const dt = DateTime.local().setZone(globalTimezone);
            if (!dt.isValid) {
                throw new Error(`Invalid timezone: ${globalTimezone}`);
            }

            return globalTimezone;
        } else {
            const inputTimezone =
                taskOptions.timezone || this.options.timezone.type;

            const dt = DateTime.local().setZone(inputTimezone);
            if (!dt.isValid) {
                throw new Error(`Invalid timezone: ${inputTimezone}`);
            }

            return inputTimezone;
        }
    }

    /**
     * Adds a new task to the scheduler
     *
     * @param {Omit<CronTask, 'id' | 'metadata'>} task - Task configuration without id and metadata
     * @returns {Promise<CronTask>} The complete task object with generated id and metadata
     * @throws {Error} If the task addition fails or timezone configuration is invalid
     */
    async addTask(
        task: Omit<CronTask, "id" | "metadata" | "status">
    ): Promise<CronTask> {
        try {
            if (this.options.timezone?.strict && "timezone" in task.options) {
                if (task.options.timezone !== this.options.timezone.type) {
                    throw new Error(
                        "Cannot set per-task timezone when timezone.strict is enabled. " +
                            "Use the module-level timezone configuration instead."
                    );
                }
            }

            const activeTimezone = this.getActiveTimezone(task.options);

            const newTask: CronTask = {
                ...task,
                status: "pending",
                id: crypto.randomUUID(),
                options: {
                    ...task.options,
                    timezone: activeTimezone,
                },
                metadata: {
                    runCount: 0,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            };

            const moduleOptions: ModuleOptions =
                moduleConfiguration.getModuleOptions();

            CronExpressionParser.parseCronExpression(
                newTask.options.expression,
                {
                    timezone: {
                        ...moduleOptions.timezone,
                        type: activeTimezone,
                    },
                    validateTimezone: this.options.timezone?.validate ?? true,
                }
            );

            newTask.metadata.nextRun = this.getNextRunTime(newTask);

            this.queue.add(newTask);
            await this.persist(newTask);

            return newTask;
        } catch (error: unknown) {
            const wrappedError = this.handleError("Failed to add task", error);
            this.emitError(wrappedError);
            throw wrappedError;
        }
    }

    /**
     * Removes a task from the scheduler
     *
     * @param {TaskId} taskId - The ID of the task to remove
     * @returns {Promise<void>}
     */
    async removeTask(taskId: TaskId): Promise<void> {
        const removed = this.queue.remove(taskId);

        if (!removed) return;

        try {
            // Removing from the queue alone left the task behind in storage,
            // so restore() brought it back on the next boot.
            await this.storage.remove(taskId);
        } catch (error: unknown) {
            const wrappedError = this.handleError(
                `Failed to remove task ${taskId} from storage`,
                error
            );
            this.emitError(wrappedError);
            throw wrappedError;
        }
    }

    /**
     * Pauses a task
     *
     * @param {TaskId} taskId - The ID of the task to pause
     * @returns {Promise<void>}
     */
    async pauseTask(taskId: TaskId): Promise<void> {
        this.queue.pause(taskId);
        await this.persist(this.queue.get(taskId));
    }

    /**
     * Resumes a paused task
     *
     * @param {TaskId} taskId - The ID of the task to resume
     * @returns {Promise<void>}
     */
    async resumeTask(taskId: TaskId): Promise<void> {
        const task = this.queue.get(taskId);

        if (task && task.status === "paused") {
            this.queue.resume(taskId);
            task.metadata.nextRun = this.getNextRunTime(task);
            await this.persist(task);
        }
    }

    /**
     * Gets a task by ID
     *
     * @param {TaskId} taskId - The ID of the task to retrieve
     * @returns {CronTask | undefined} The task if found, undefined otherwise
     */
    getTask(taskId: TaskId): CronTask | undefined {
        return this.queue.get(taskId);
    }

    /**
     * Gets all tasks in the scheduler
     *
     * @returns {CronTask[]} Array of all tasks
     */
    getAllTasks(): CronTask[] {
        return this.queue.getAll();
    }

    /**
     * Gets current scheduler statistics
     *
     * @returns {SchedulerStats} Current scheduler statistics
     */
    getStats(): SchedulerStats {
        // Counted on read rather than on every tick: the numbers are only
        // ever observed here.
        this.updateStats();

        if (this.startTime) {
            this.stats.uptime = Date.now() - this.startTime.getTime();
        }

        return { ...this.stats };
    }

    /**
     * Waits for a task to complete
     *
     * @private
     * @param {TaskId} taskId - The ID of the task to wait for
     * @returns {Promise<void>} Resolves when the task completes or is no longer running
     */
    private waitForTask(taskId: TaskId): Promise<void> {
        return new Promise((resolve) => {
            const checkCompletion = () => {
                const task = this.queue.get(taskId);

                if (!task || task.status !== "running") {
                    resolve();
                } else {
                    setTimeout(checkCompletion, 100);
                }
            };

            checkCompletion();
        });
    }

    /**
     * Calculates the next run time for a task
     *
     * @param {CronTask} task - The task to calculate next run time for
     * @returns {Date} The next scheduled run time
     * @throws {Error} If the cron expression is invalid
     */
    public getNextRunTime(task: CronTask): Date {
        try {
            const effectiveTimezone = this.options.timezone?.strict
                ? this.options.timezone.type
                : task.options.timezone || this.options.timezone?.type || "UTC";

            const moduleOptions: ModuleOptions =
                moduleConfiguration.getModuleOptions();

            const parsed = CronExpressionParser.parseCronExpression(
                task.options.expression,
                {
                    timezone: {
                        ...moduleOptions.timezone,
                        type: effectiveTimezone,
                    },
                    validateTimezone: this.options.timezone?.validate ?? true,
                }
            );
            return this.calculateNextRunTime(
                parsed,
                task.options.expression
            );
        } catch (error: unknown) {
            const wrappedError = this.handleError(
                `Invalid cron expression for task ${task.id}`,
                error
            );
            this.emitError(wrappedError);

            if (error instanceof UnsatisfiableCronExpressionError) {
                // Retrying this daily would re-run the whole search every day
                // for an expression we already know can never match. Park it
                // beyond the horizon so the task stays registered and
                // runnable on demand, but never becomes due.
                console.warn(
                    `[ nuxt-task ] Task ${task.id} is scheduled `
                    + `"${task.options.expression}", which can never run. `
                    + `It will not be scheduled.`
                );

                const parked = new Date();
                parked.setFullYear(
                    parked.getFullYear()
                    + Scheduler.MAX_NEXT_RUN_HORIZON_YEARS
                );
                return parked;
            }

            return new Date(Date.now() + 24 * 60 * 60 * 1000);
        }
    }

    /**
     * Calculates the next valid run time based on a parsed cron expression
     *
     * @private
     * @param {ParsedExpression} parsed - The parsed cron expression
     * @returns {Date} The next valid run time
     * @throws {Error} If timezone conversion fails
     */
    private calculateNextRunTime(
        parsed: ParsedExpression,
        expression: string = "unknown"
    ): Date {
        return computeNextRunTime(parsed, expression, new Date());
    }

    /**
     * Executes the scheduler tick to check and run due tasks
     *
     * @private
     * @returns {Promise<void>}
     */
    private async tick(): Promise<void> {
        if (!this.running) return;

        try {
            const now = new Date();
            const tasks = this.queue.getAll();

            const tasksToRun = tasks.filter((task) => {
                if (
                    task.status === "paused" ||
                    !task.metadata.nextRun ||
                    this.queue.isRunning(task.id)
                ) {
                    return false;
                }

                // The parser only ever echoed this timezone back, so
                // re-parsing every task on every tick bought nothing and made
                // one bad timezone throw inside the filter, which stopped
                // every other task from running that tick. The expression was
                // already validated once when the task was added, and neither
                // it nor the timezone can change afterwards.
                const effectiveTimezone = this.options.timezone?.strict
                    ? this.options.timezone.type
                    : task.options.timezone ||
                      this.options.timezone?.type ||
                      "UTC";

                // Scoped to this task: a single unusable timezone used to
                // throw out of the filter and cancel the whole tick, so one
                // bad task silently stopped every other task from running.
                try {
                    const tzNow = TimezoneUtils.convertTimezone(
                        now,
                        "UTC",
                        effectiveTimezone
                    );
                    const tzNextRun = TimezoneUtils.convertTimezone(
                        task.metadata.nextRun,
                        "UTC",
                        effectiveTimezone
                    );

                    if (
                        typeof tzNow === "string" ||
                        typeof tzNextRun === "string"
                    ) {
                        throw new TypeError(
                            "Unexpected string return from timezone conversion"
                        );
                    }

                    return tzNextRun.toJSDate() <= tzNow.toJSDate();
                } catch (error: unknown) {
                    this.emitError(
                        this.handleError(
                            `Failed to evaluate schedule for task ${task.id}`,
                            error
                        )
                    );
                    return false;
                }
            });

            // Respect max concurrency
            const currentRunning = this.queue.runningCount();
            const available = Math.max(
                0,
                this.options.maxConcurrent! - currentRunning
            );
            const toExecute = tasksToRun.slice(0, available);

            // Execute due tasks in parallel and wait for completion
            await Promise.all(
                toExecute.map(async (task) => {
                    await this.queue.executeTask(task.id);
                    const executedTask = this.queue.get(task.id);
                    if (executedTask) {
                        executedTask.metadata.nextRun =
                            this.getNextRunTime(executedTask);
                    }
                })
            );
        } catch (error: unknown) {
            const wrappedError = this.handleError(
                "Scheduler tick failed",
                error
            );
            this.emitError(wrappedError);
        }
    }

    /**
     * Updates the next run time for a task and persists the change
     *
     * @private
     * @param {CronTask} task - The task to update
     */
    private updateNextRunTime(task: CronTask): void {
        task.metadata.nextRun = this.getNextRunTime(task);

        this.persist(task).catch((error: unknown) => {
            const wrappedError = this.handleError(
                "Failed to persist task state",
                error
            );
            this.emitError(wrappedError);
        });
    }

    /**
     * Handles tasks that were missed during scheduler downtime
     *
     * @private
     * @returns {Promise<void>}
     * @throws {Error} If handling missed tasks fails
     * @description Executes any tasks that were scheduled to run during downtime
     * if their catchUp option is enabled
     */
    private async handleMissedTasks(): Promise<void> {
        try {
            const now = new Date();
            const tasks = this.queue.getAll();

            for (const task of tasks) {
                if (
                    task.options.catchUp &&
                    task.metadata.nextRun &&
                    task.metadata.nextRun < now
                ) {
                    await this.queue.executeTask(task.id);
                    this.updateNextRunTime(task);
                    task.metadata.nextRun = this.getNextRunTime(task);
                }
            }
        } catch (error: unknown) {
            const wrappedError = this.handleError(
                "Failed to handle missed tasks",
                error
            );
            this.emitError(wrappedError);
            throw wrappedError;
        }
    }

    /**
     * Updates the scheduler's internal statistics
     *
     * @private
     * @description Updates the count of active and queued tasks
     */
    private updateStats(): void {
        this.stats.activeTasks = this.queue
            .getAll()
            .filter((task) => task.status === "running").length;

        this.stats.queuedTasks = this.queue
            .getAll()
            .filter((task) => task.status === "pending").length;
    }

    /**
     * Updates the scheduler's internal statistics
     *
     * @private
     * @description Updates the count of active and queued tasks
     */
    private async persist(task?: CronTask): Promise<void> {
        try {
            // A single changed task writes only itself. Every mutation used to
            // rewrite the entire queue, so adding one task to a queue of fifty
            // issued fifty reads and fifty writes.
            const tasks = task ? [task] : this.queue.getAll();
            await Promise.all(
                tasks.map(async (task) => {
                    const existingTask = await this.storage.get(task.id);

                    if (existingTask) {
                        await this.storage.update(task.id, task);
                    } else {
                        await this.storage.add(task);
                    }
                })
            );
        } catch (error: unknown) {
            const wrappedError = this.handleError(
                "Failed to persist scheduler state",
                error
            );
            this.emitError(wrappedError);
            throw wrappedError;
        }
    }

    /**
     * Restores scheduler state from storage
     *
     * @private
     * @returns {Promise<void>}
     * @throws {Error} If restoration fails
     * @description Loads all tasks from storage and adds them to the queue
     */
    private async restore(): Promise<void> {
        try {
            this.queue.clear();
            const tasks = await this.storage.getAll();
            tasks.forEach((task) => this.queue.add(task));
        } catch (error: unknown) {
            const wrappedError = this.handleError(
                "Failed to restore scheduler state",
                error
            );
            this.emitError(wrappedError);
            throw wrappedError;
        }
    }
}

export type {
    CronTask,
    CronTaskEvent,
    TaskId,
    CronTaskOptions,
    FlexibleCronTaskOptions,
    CronStorage,
    ParsedExpression,
    SchedulerOptions,
    SchedulerStats,
    SchedulerBaseOptions,
    ModuleOptions,
};
