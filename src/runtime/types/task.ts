import type { SchedulerOptions } from '../utils/task/scheduler/types'



export type TaskId = string

export interface CronTaskMetadata {
    lastRun?: Date
    nextRun?: Date
    lastError?: Error
    runCount: number
    createdAt: Date
    updatedAt: Date
}

export type CronTaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'paused'

interface BaseCronTaskOptions {
    expression: string
    maxRetries?: number
    retryDelay?: number
    timeout?: number
    exclusive?: boolean
    catchUp?: boolean
}

export interface FlexibleCronTaskOptions extends BaseCronTaskOptions {
    timezone?: string
}

export type StrictCronTaskOptions = BaseCronTaskOptions

export type CronTaskOptions<T extends SchedulerOptions = SchedulerOptions> =
    T['timezone'] extends { strict: true }
    ? StrictCronTaskOptions
    : FlexibleCronTaskOptions

export interface CronTask<T = any> {
    id: TaskId
    name: string
    execute: () => Promise<T>
    options: CronTaskOptions
    status: CronTaskStatus
    metadata: CronTaskMetadata
}

export type CronTaskEvent =
    | { type: 'started', task: CronTask }
    | { type: 'completed', task: CronTask, result: any }
    | { type: 'failed', task: CronTask, error: Error }
    | { type: 'retry', task: CronTask, attempt: number }
    | { type: 'paused', task: CronTask }
    | { type: 'resumed', task: CronTask }