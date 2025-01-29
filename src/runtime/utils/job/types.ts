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

export interface CronJobOptions {
  // The cron expression
  expression: string
  
  // Timezone for the job, defaults to system timezone
  timezone?: string
  
  // Maximum number of retries if job fails
  maxRetries?: number
  
  // Delay between retries in milliseconds
  retryDelay?: number
  
  // Maximum execution time in milliseconds
  timeout?: number
  
  // If true, only one instance of the job can run at a time
  exclusive?: boolean
  
  // If true, missed executions will be run immediately on startup
  catchUp?: boolean
}

export interface CronJob<T = any> {
  // Unique identifier for the job
  id: JobId
  
  // Name of the job for display/logging
  name: string
  
  // The actual function to execute
  execute: () => Promise<T>
  
  // Job configuration
  options: CronJobOptions
  
  // Current status of the job
  status: JobStatus
  
  // Metadata about job execution
  metadata: JobMetadata
}

export type JobEvent = 
  | { type: 'started'; job: CronJob }
  | { type: 'completed'; job: CronJob; result: any }
  | { type: 'failed'; job: CronJob; error: Error }
  | { type: 'retry'; job: CronJob; attempt: number }
  | { type: 'paused'; job: CronJob }
  | { type: 'resumed'; job: CronJob }