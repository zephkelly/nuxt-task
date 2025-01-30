import type { JobEvent } from '../types'
import type { FlexibleTimezoneModuleOptions, ModuleOptions, StrictTimezoneModuleOptions } from '~/src/module'



export interface SchedulerBaseOptions {
    tickInterval?: number
    maxConcurrent?: number
    defaultRetryOptions?: {
        maxRetries: number
        retryDelay: number
    }
    defaultTimeout?: number
    handleMissedJobs?: boolean
}


export interface SchedulerOptions extends SchedulerBaseOptions {
    timezone: ModuleOptions['timezone']
}

export type SchedulerEvents = {
    [K in JobEvent['type']as `job-${K}`]: (event: Extract<JobEvent, { type: K }>) => void;
} & {
    error: (error: Error) => void
    [key: string]: (...args: any[]) => void
}

export interface SchedulerStats {
    totalJobsRun: number
    totalJobsFailed: number
    totalJobsRetried: number
    activeJobs: number
    queuedJobs: number
    lastTick?: Date
    uptime: number
}

export interface ExtendedJobMetadata {
    lastRunDuration?: number
    averageRuntime?: number
    failureRate?: number
    totalRuns: number
    totalFailures: number
    totalRetries: number
    created: Date
    modified: Date
}

export interface JobExecutionResult<T = any> {
    success: boolean
    result?: T
    error?: Error
    duration: number
    startTime: Date
    endTime: Date
}

export interface JobContext {
    attempt: number
    previousError?: Error
    startTime: Date
    metadata: ExtendedJobMetadata
}

export interface TypedEventEmitter<Events extends Record<string | symbol, (...args: any[]) => any>> {
    addListener<E extends keyof Events>(event: E, listener: Events[E]): this
    on<E extends keyof Events>(event: E, listener: Events[E]): this
    once<E extends keyof Events>(event: E, listener: Events[E]): this
    prependListener<E extends keyof Events>(event: E, listener: Events[E]): this
    prependOnceListener<E extends keyof Events>(event: E, listener: Events[E]): this
    removeListener<E extends keyof Events>(event: E, listener: Events[E]): this
    off<E extends keyof Events>(event: E, listener: Events[E]): this
    removeAllListeners<E extends keyof Events>(event?: E): this
    listeners<E extends keyof Events>(event: E): Events[E][]
    rawListeners<E extends keyof Events>(event: E): Events[E][]
    emit<E extends keyof Events>(event: E, ...args: Parameters<Events[E]>): boolean
    listenerCount<E extends keyof Events>(event: E): number
    eventNames(): Array<keyof Events>
}



// Helper functions
export function createStrictModuleOptions(
    options: StrictTimezoneModuleOptions,
): StrictTimezoneModuleOptions {
    return {
        ...options,
        storage: options.storage ?? { type: 'memory' },
        timezone: {
            type: options.timezone?.type ?? 'UTC',
            validate: options.timezone?.validate ?? true,
            strict: true,
        },
    }
}

export function createFlexibleModuleOptions(
    options: FlexibleTimezoneModuleOptions,
): FlexibleTimezoneModuleOptions {
    return {
        ...options,
        storage: options.storage ?? { type: 'memory' },
        timezone: {
            type: options.timezone?.type ?? 'UTC',
            validate: options.timezone?.validate ?? true,
            strict: false,
        },
    }
}