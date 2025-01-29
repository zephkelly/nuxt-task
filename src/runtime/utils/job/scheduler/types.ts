import type { JobEvent } from '../types';



export type SchedulerEvents = {
        [K in JobEvent['type']as `job-${K}`]: (event: Extract<JobEvent, { type: K }>) => void;
    } & {
        error: (error: Error) => void;
        [key: string]: (...args: any[]) => void;
};

export interface TypedEventEmitter<Events extends Record<string | symbol, (...args: any[]) => any>> {
    addListener<E extends keyof Events>(event: E, listener: Events[E]): this;
    on<E extends keyof Events>(event: E, listener: Events[E]): this;
    once<E extends keyof Events>(event: E, listener: Events[E]): this;
    prependListener<E extends keyof Events>(event: E, listener: Events[E]): this;
    prependOnceListener<E extends keyof Events>(event: E, listener: Events[E]): this;
    removeListener<E extends keyof Events>(event: E, listener: Events[E]): this;
    off<E extends keyof Events>(event: E, listener: Events[E]): this;
    removeAllListeners<E extends keyof Events>(event?: E): this;
    listeners<E extends keyof Events>(event: E): Events[E][];
    rawListeners<E extends keyof Events>(event: E): Events[E][];
    emit<E extends keyof Events>(event: E, ...args: Parameters<Events[E]>): boolean;
    listenerCount<E extends keyof Events>(event: E): number;
    eventNames(): Array<keyof Events>;
}

// Configuration options for the scheduler
export interface SchedulerOptions {
    tickInterval?: number;
    
    maxConcurrent?: number;
    
    defaultRetryOptions?: {
      maxRetries: number;
      retryDelay: number;
    };
    
    defaultTimeout?: number;
    
    // Whether to handle missed jobs on startup
    handleMissedJobs?: boolean;
}

export interface SchedulerStats {
    totalJobsRun: number;
    totalJobsFailed: number;
    totalJobsRetried: number;
    activeJobs: number;
    queuedJobs: number;
    lastTick?: Date;
    uptime: number;
}

export interface ExtendedJobMetadata {
    lastRunDuration?: number;
    averageRuntime?: number;
    failureRate?: number;
    totalRuns: number;
    totalFailures: number;
    totalRetries: number;
    created: Date;
    modified: Date;
}

export interface JobExecutionResult<T = any> {
    success: boolean;
    result?: T;
    error?: Error;
    duration: number;
    startTime: Date;
    endTime: Date;
}

export interface JobContext {
    attempt: number;
    previousError?: Error;
    startTime: Date;
    metadata: ExtendedJobMetadata;
}