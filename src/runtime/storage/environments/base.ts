import { randomUUID } from 'node:crypto'

import type { CronTask, CronTaskMetadata } from '../../task/types'



export interface BaseStorageConfig {
    prefix?: string
}

export abstract class BaseStorage {
    protected prefix: string

    constructor(config?: BaseStorageConfig) {
        this.prefix = config?.prefix || 'cron:'
    }

    protected generateId(): string {
        return randomUUID()
    }

    protected getKey(id: string): string {
        return `${this.prefix}${id}`
    }

    protected validateDate(date: unknown): Date | undefined {
        if (date instanceof Date && !isNaN(date.getTime())) {
            return date
        }
        return undefined
    }

    protected createTaskMetadata(
        task: Partial<CronTask>,
        now: Date,
    ): CronTaskMetadata {
        return {
            lastRun: this.validateDate(task.metadata?.lastRun),
            nextRun: this.validateDate(task.metadata?.nextRun),
            lastError: task.metadata?.lastError,
            runCount: task.metadata?.runCount ?? 0,
            createdAt: now,
            updatedAt: now,
        }
    }

    protected createTaskObject(
        task: Omit<CronTask, 'id' | 'metadata'>,
        id?: string,
    ): CronTask {
        const now = new Date()

        const options = {
            timezone: task.options?.timezone || 'UTC',
            ...task.options
        }

        return {
            ...task,
            id: id || this.generateId(),
            options,
            metadata: this.createTaskMetadata(task, now),
        }
    }

    protected updateTaskObject(
        existingTask: CronTask,
        updates: Partial<CronTask>,
    ): CronTask {
        const now = new Date()
        const metadata: CronTaskMetadata = {
            ...existingTask.metadata,
            ...updates.metadata,
            updatedAt: now,
            lastRun: updates.metadata?.lastRun !== undefined
                ? this.validateDate(updates.metadata.lastRun)
                : existingTask.metadata.lastRun,
            nextRun: updates.metadata?.nextRun !== undefined
                ? this.validateDate(updates.metadata.nextRun)
                : existingTask.metadata.nextRun,
        }

        const options = {
            ...existingTask.options,
            ...(updates.options || {}),
            timezone: updates.options?.timezone || existingTask.options.timezone || 'UTC'
        }

        return {
            ...existingTask,
            ...updates,
            options,
            id: existingTask.id,
            metadata,
        }
    }
}