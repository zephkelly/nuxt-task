import type { SchedulerOptions } from './scheduler/types'

export type JobId = string

export interface JobMetadata {
  lastRun?: Date
  nextRun?: Date
  lastError?: Error
  runCount: number
  createdAt: Date
  updatedAt: Date
}

export type JobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'paused'

interface BaseCronJobOptions {
  expression: string
  maxRetries?: number
  retryDelay?: number
  timeout?: number
  exclusive?: boolean
  catchUp?: boolean
}

export interface FlexibleCronJobOptions extends BaseCronJobOptions {
  timezone?: string
}

export type StrictCronJobOptions = BaseCronJobOptions

export type CronJobOptions<T extends SchedulerOptions = SchedulerOptions> =
    T['timezone'] extends { strict: true }
      ? StrictCronJobOptions
      : FlexibleCronJobOptions

export interface CronJob<T = any> {
    id: JobId
    name: string
    execute: () => Promise<T>
    options: CronJobOptions
    status: JobStatus
    metadata: JobMetadata
}

export type JobEvent =
    | { type: 'started', job: CronJob }
    | { type: 'completed', job: CronJob, result: any }
    | { type: 'failed', job: CronJob, error: Error }
    | { type: 'retry', job: CronJob, attempt: number }
    | { type: 'paused', job: CronJob }
    | { type: 'resumed', job: CronJob }
