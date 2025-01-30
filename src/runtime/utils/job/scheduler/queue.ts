import { EventEmitter } from 'node:events'
import type { CronJob, JobId } from '../types'



export class JobQueue extends EventEmitter {
    private queue: Map<JobId, CronJob>
    private running: Set<JobId>

    constructor() {
        super()
        this.queue = new Map()
        this.running = new Set()
    }

    add(job: CronJob): void {
        if (this.queue.has(job.id)) {
            throw new Error(`Job with id ${job.id} already exists`)
        }

        this.queue.set(job.id, job)
    }

    remove(jobId: JobId): boolean {
        return this.queue.delete(jobId)
    }

    get(jobId: JobId): CronJob | undefined {
        return this.queue.get(jobId)
    }

    getAll(): CronJob[] {
        return Array.from(this.queue.values())
    }

    isRunning(jobId: JobId): boolean {
        return this.running.has(jobId)
    }

    async executeJob(jobId: JobId): Promise<void> {
        const job = this.queue.get(jobId)

        if (!job) {
            throw new Error(`Job ${jobId} not found`)
        }

        if (job.options.exclusive && this.isRunning(jobId)) {
            return
        }

        if (job.metadata.runCount > (job.options.maxRetries || 0)) {
            return
        }

        this.running.add(jobId)
        job.status = 'running'
        this.emit('started', { type: 'started', job })

        try {
            const result = await Promise.race([
                job.execute(),
                job.options.timeout
                ? new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('Job timeout')), job.options.timeout),
                )
                : Promise.resolve(),
            ])

            job.status = 'completed'
            job.metadata.lastRun = new Date()
            job.metadata.runCount++
            this.emit('completed', { type: 'completed', job, result })
        }
        catch (error: unknown) {
            job.status = 'failed'
            job.metadata.lastError = error as Error
            job.metadata.runCount++

            if (job.metadata.runCount <= (job.options.maxRetries || 0)) {
                this.emit('retry', { type: 'retry', job, attempt: job.metadata.runCount })

                const retryTimeout = setTimeout(() => {
                this.executeJob(jobId)
                clearTimeout(retryTimeout)
                }, job.options.retryDelay || 1000)
            }
            else {
                this.emit('failed', { type: 'failed', job, error: error as Error })
            }
        }
        finally {
            this.running.delete(jobId)
        }
    }

    pause(jobId: JobId): void {
        const job = this.queue.get(jobId)

        if (job) {
            job.status = 'paused'
            this.emit('paused', { type: 'paused', job })
        }
    }

    resume(jobId: JobId): void {
        const job = this.queue.get(jobId)

        if (job && job.status === 'paused') {
            job.status = 'pending'
            this.emit('resumed', { type: 'resumed', job })
        }
    }

    clear(): void {
        this.queue.clear()
        this.running.clear()
    }
}