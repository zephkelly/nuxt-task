import { EventEmitter } from 'node:events'
import type { CronTask, TaskId } from '~/src/runtime/task/types'

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

    constructor() {
        super()
        this.queue = new Map()
        this.running = new Set()
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
            return
        }

        // Calculate total allowed attempts (initial + retries)
        const maxAttempts = task.options.maxRetries ? 
            (task.options.maxRetries === 0) ? 0 : task.options.maxRetries + 1
            : -1

        // Skip if we've reached max attempts
        if (maxAttempts !== -1 && task.metadata.runCount >= maxAttempts) {
            return
        }

        this.running.add(taskId)
        task.status = 'running'
        this.emit('started', { type: 'started', task })

        try {
            const result = await Promise.race([
                task.execute(),
                task.options.timeout
                    ? new Promise((_, reject) =>
                        setTimeout(() => reject(new Error('task timeout')), task.options.timeout),
                    )
                    : Promise.resolve(),
            ])

            task.status = 'completed'
            task.metadata.lastRun = new Date()
            task.metadata.runCount++

            this.emit('completed', { type: 'completed', task, result })
        }
        catch (error: unknown) {
            task.status = 'failed'
            task.metadata.lastError = error as Error
            task.metadata.runCount++

            this.emit('failed', { type: 'failed', task, error: error as Error })

            if (task.metadata.runCount < maxAttempts) {
                this.emit('retry', { type: 'retry', task, attempt: task.metadata.runCount })

                const retryTimeout = setTimeout(() => {
                    this.executeTask(taskId)
                    clearTimeout(retryTimeout)
                }, task.options.retryDelay || 1000)
            }
        }
        finally {
            this.running.delete(taskId)
        }
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
        this.queue.clear()
        this.running.clear()
    }
}

export type {
    CronTask,
    TaskId
}