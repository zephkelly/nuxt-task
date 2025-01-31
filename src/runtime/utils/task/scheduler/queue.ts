import { EventEmitter } from 'node:events'
import type { CronTask, TaskId } from '~/src/runtime/types/task'



export class TaskQueue extends EventEmitter {
    private queue: Map<TaskId, CronTask>
    private running: Set<TaskId>

    constructor() {
        super()
        this.queue = new Map()
        this.running = new Set()
    }

    add(task: CronTask): void {
        if (this.queue.has(task.id)) {
            throw new Error(`task with id ${task.id} already exists`)
        }

        this.queue.set(task.id, task)
    }

    remove(taskId: TaskId): boolean {
        return this.queue.delete(taskId)
    }

    get(taskId: TaskId): CronTask | undefined {
        return this.queue.get(taskId)
    }

    getAll(): CronTask[] {
        return Array.from(this.queue.values())
    }

    isRunning(taskId: TaskId): boolean {
        return this.running.has(taskId)
    }

    async executeTask(taskId: TaskId): Promise<void> {
        const task = this.queue.get(taskId)

        if (!task) {
            throw new Error(`task ${taskId} not found`)
        }

        if (task.options.exclusive && this.isRunning(taskId)) {
            return
        }

        if (task.metadata.runCount > (task.options.maxRetries || 0)) {
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

            if (task.metadata.runCount <= (task.options.maxRetries || 0)) {
                this.emit('retry', { type: 'retry', task, attempt: task.metadata.runCount })

                const retryTimeout = setTimeout(() => {
                    this.executeTask(taskId)
                    clearTimeout(retryTimeout)
                }, task.options.retryDelay || 1000)
            }
            else {
                this.emit('failed', { type: 'failed', task, error: error as Error })
            }
        }
        finally {
            this.running.delete(taskId)
        }
    }

    pause(taskId: TaskId): void {
        const task = this.queue.get(taskId)

        if (task) {
            task.status = 'paused'
            this.emit('paused', { type: 'paused', task })
        }
    }

    resume(taskId: TaskId): void {
        const task = this.queue.get(taskId)

        if (task && task.status === 'paused') {
            task.status = 'pending'
            this.emit('resumed', { type: 'resumed', task })
        }
    }

    clear(): void {
        this.queue.clear()
        this.running.clear()
    }
}