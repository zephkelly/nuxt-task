import { EventEmitter } from 'node:events'
import type { CronTask, TaskId } from '../task/types'

/**
 * @class TaskQueue
 * @extends EventEmitter
 * @description Manages a queue of cron tasks with execution, retry, and state management capabilities
 *
 * @fires TaskQueue#started - Emitted when a task starts execution
 * @fires TaskQueue#completed - Emitted when a task completes successfully
 * @fires TaskQueue#failed - Emitted when a task fails and has no more retries
 * @fires TaskQueue#retry - Emitted when a task fails but will be retried
 * @fires TaskQueue#paused - Emitted when a task is paused
 * @fires TaskQueue#resumed - Emitted when a task is resumed
 */
export class TaskQueue extends EventEmitter {
    /** Map of task IDs to task objects */
    private queue: Map<TaskId, CronTask>
    /** Set of currently running task IDs */
    private running: Set<TaskId>
    /** Pending retry delays, so they can be cancelled on remove/clear */
    private retryTimers: Map<TaskId, {
        timer: ReturnType<typeof setTimeout>
        resolve: (proceed: boolean) => void
    }>

    constructor() {
        super()
        this.queue = new Map()
        this.running = new Set()
        this.retryTimers = new Map()
    }

    /**
 * Adds a new task to the queue
 *
 * @param {CronTask} task - The task to add
 * @throws {Error} If a task with the same ID already exists
 */
    add(task: CronTask): void {
        if (this.queue.has(task.id)) {
            throw new Error(`task with id ${task.id} already exists`)
        }
        this.queue.set(task.id, task)
    }

    /**
 * Removes a task from the queue
 *
 * @param {TaskId} taskId - ID of the task to remove
 * @returns {boolean} true if the task was removed, false if it didn't exist
 */
    remove(taskId: TaskId): boolean {
        this.cancelRetries(taskId)
        return this.queue.delete(taskId)
    }

    /**
 * Retrieves a task by its ID
 *
 * @param {TaskId} taskId - ID of the task to retrieve
 * @returns {CronTask | undefined} The task if found, undefined otherwise
 */
    get(taskId: TaskId): CronTask | undefined {
        return this.queue.get(taskId)
    }

    /**
 * Gets all tasks in the queue
 *
 * @returns {CronTask[]} Array of all tasks
 */
    getAll(): CronTask[] {
        return Array.from(this.queue.values())
    }

    /**
 * Checks if a task is currently running
 *
 * @param {TaskId} taskId - ID of the task to check
 * @returns {boolean} true if the task is running, false otherwise
 */
    isRunning(taskId: TaskId): boolean {
        return this.running.has(taskId)
    }

    /**
 * Number of tasks currently running
 *
 * @returns {number} Count of in-flight tasks
 */
    runningCount(): number {
        return this.running.size
    }

    /**
 * Executes a task with retry and timeout handling
 *
 * @param {TaskId} taskId - ID of the task to execute
 * @returns {Promise<void>}
 * @throws {Error} If the task is not found
 *
 * @fires TaskQueue#started
 * @fires TaskQueue#completed
 * @fires TaskQueue#failed
 * @fires TaskQueue#retry
 *
 * @description
 * This method handles:
 * - Task execution with optional timeout
 * - Retry logic with configurable delay
 * - Exclusive execution mode
 * - Task status updates
 * - Event emission for task lifecycle
 */
    async executeTask(taskId: TaskId): Promise<void> {
        const task = this.queue.get(taskId)
        if (!task) {
            throw new Error(`task ${taskId} not found`)
        }

        // Skip if task is exclusive and already running
        if (task.options.exclusive && this.isRunning(taskId)) {
            return;
        }

        const maxAttempts = this.getMaxAttempts(task)

        this.running.add(taskId)
        task.status = 'running'
        this.emit('started', { type: 'started', task })

        try {
            for (let attempt = 1; attempt <= maxAttempts; attempt++) {
                try {
                    const result = await this.runOnce(task)

                    task.status = 'completed'
                    task.metadata.lastRun = new Date()
                    task.metadata.runCount++

                    this.emit('completed', { type: 'completed', task, result })
                    return
                }
                catch (error: unknown) {
                    task.status = 'failed'
                    task.metadata.lastError = error as Error
                    task.metadata.runCount++

                    this.emit('failed', {
                        type: 'failed',
                        task,
                        error: error as Error,
                    })

                    if (attempt >= maxAttempts) {
                        return
                    }

                    this.emit('retry', { type: 'retry', task, attempt })

                    const proceed = await this.delayRetry(
                        taskId,
                        task.options.retryDelay || 1000,
                    )

                    // Cancelled by remove()/clear() while we were waiting.
                    if (!proceed) {
                        return
                    }
                }
            }
        }
        finally {
            this.running.delete(taskId)
        }
    }

    /**
 * Total attempts allowed for one scheduled run: the initial attempt plus
 * `maxRetries` retries.
 *
 * The budget belongs to a single scheduled run. It used to be compared
 * against `metadata.runCount`, a lifetime counter incremented on success as
 * well as failure, so `maxRetries: 3` silently stopped a recurring task
 * forever after four ticks, and `maxRetries: 0` meant the task never ran at
 * all.
 *
 * @param {CronTask} task - The task to size a budget for
 * @returns {number} Attempts allowed, always at least one
 */
    private getMaxAttempts(task: CronTask): number {
        const maxRetries = task.options.maxRetries

        if (maxRetries === undefined || maxRetries === null) {
            return 1
        }

        return Math.max(0, maxRetries) + 1
    }

    /**
 * Runs a single attempt, racing against the timeout only when one is set.
 *
 * The race previously used `Promise.resolve()` as its second arm whenever no
 * timeout was configured. That promise is already settled, so it won every
 * race: the task was reported complete with an undefined result before its
 * handler had finished, real failures were discarded, and `running` was
 * cleared immediately, which left `exclusive` inert.
 *
 * @param {CronTask} task - The task to run
 * @returns {Promise<unknown>} The handler's result
 */
    private async runOnce(task: CronTask): Promise<unknown> {
        const execution = task.execute({
            name: task.name,
            scheduledTime: new Date().getTime(),
            timezone: task.options.timezone || 'UTC',
        })

        if (!task.options.timeout) {
            return await execution
        }

        let timer: ReturnType<typeof setTimeout> | undefined

        try {
            return await Promise.race([
                execution,
                new Promise((_, reject) => {
                    timer = setTimeout(
                        () => reject(new Error('task timeout')),
                        task.options.timeout,
                    )
                }),
            ])
        }
        finally {
            if (timer) clearTimeout(timer)
        }
    }

    /**
 * Waits out a retry delay, resolving false if the wait is cancelled.
 *
 * Retries used to be scheduled with a bare `setTimeout` that was never
 * tracked, so a removed task kept retrying and its rejection went unhandled.
 *
 * @param {TaskId} taskId - The task being retried
 * @param {number} delay - Delay in milliseconds
 * @returns {Promise<boolean>} true to proceed, false if cancelled
 */
    private delayRetry(taskId: TaskId, delay: number): Promise<boolean> {
        return new Promise<boolean>((resolve) => {
            const timer = setTimeout(() => {
                this.retryTimers.delete(taskId)
                resolve(true)
            }, delay)

            this.retryTimers.set(taskId, { timer, resolve })
        })
    }

    /**
 * Cancels a pending retry delay for a task, if one is waiting.
 *
 * @param {TaskId} taskId - ID of the task whose retry should be cancelled
 */
    cancelRetries(taskId: TaskId): void {
        const pending = this.retryTimers.get(taskId)
        if (!pending) return

        clearTimeout(pending.timer)
        this.retryTimers.delete(taskId)
        pending.resolve(false)
    }

    /**
 * Pauses a task
 *
 * @param {TaskId} taskId - ID of the task to pause
 * @fires TaskQueue#paused
 */
    pause(taskId: TaskId): void {
        const task = this.queue.get(taskId)
        if (task) {
            task.status = 'paused'
            this.emit('paused', { type: 'paused', task })
        }
    }

    /**
 * Resumes a paused task
 *
 * @param {TaskId} taskId - ID of the task to resume
 * @fires TaskQueue#resumed
 */
    resume(taskId: TaskId): void {
        const task = this.queue.get(taskId)
        if (task && task.status === 'paused') {
            task.status = 'pending'
            this.emit('resumed', { type: 'resumed', task })
        }
    }

    /**
 * Clears all tasks from the queue and running set
 */
    clear(): void {
        for (const taskId of [...this.retryTimers.keys()]) {
            this.cancelRetries(taskId)
        }
        this.queue.clear()
        this.running.clear()
    }
}

export type { CronTask, TaskId }
