import type Module from 'node:module'
import type { ModuleOptions } from './../../../src/module'
import type {
  FlexibleTimezoneOptions,
  StrictTimezoneOptions,
} from './../utils/timezone'
import type { CronTaskEvent } from '~/src/runtime/task/types'

export interface SchedulerBaseOptions {
  tickInterval?: number
  maxConcurrent?: number
  defaultRetryOptions?: {
    maxRetries: number
    retryDelay: number
  }
  defaultTimeout?: number
  handleMissedTasks?: boolean
}

export interface SchedulerOptions extends SchedulerBaseOptions {
  timezone: ModuleOptions['timezone']
}

export type SchedulerEvents = {
  [K in CronTaskEvent['type'] as `task-${K}`]: (
    event: Extract<CronTaskEvent, { type: K }>
  ) => void;
} & {
  error: (error: Error) => void
  [key: string]: (...args: any[]) => void
}

export interface SchedulerStats {
  totalTasksRun: number
  totalTasksFailed: number
  totalTasksRetried: number
  activeTasks: number
  queuedTasks: number
  lastTick?: Date
  uptime: number
}

export interface ExtendedTaskMetadata {
  lastRunDuration?: number
  averageRuntime?: number
  failureRate?: number
  totalRuns: number
  totalFailures: number
  totalRetries: number
  created: Date
  modified: Date
}

export interface TaskExecutionResult<T = any> {
  success: boolean
  result?: T
  error?: Error
  duration: number
  startTime: Date
  endTime: Date
}

export interface TaskContext {
  attempt: number
  previousError?: Error
  startTime: Date
  metadata: ExtendedTaskMetadata
}

export interface TypedEventEmitter<
  Events extends Record<string | symbol, (...args: any[]) => any>,
> {
  addListener<E extends keyof Events>(event: E, listener: Events[E]): this
  on<E extends keyof Events>(event: E, listener: Events[E]): this
  once<E extends keyof Events>(event: E, listener: Events[E]): this
  prependListener<E extends keyof Events>(
    event: E,
    listener: Events[E]
  ): this
  prependOnceListener<E extends keyof Events>(
    event: E,
    listener: Events[E]
  ): this
  removeListener<E extends keyof Events>(event: E, listener: Events[E]): this
  off<E extends keyof Events>(event: E, listener: Events[E]): this
  removeAllListeners<E extends keyof Events>(event?: E): this
  listeners<E extends keyof Events>(event: E): Events[E][]
  rawListeners<E extends keyof Events>(event: E): Events[E][]
  emit<E extends keyof Events>(
    event: E,
    ...args: Parameters<Events[E]>
  ): boolean
  listenerCount<E extends keyof Events>(event: E): number
  eventNames(): Array<keyof Events>
}

// Helper functions
export function createStrictModuleOptions(
  options: ModuleOptions & { timezone?: StrictTimezoneOptions },
): ModuleOptions & { timezone?: StrictTimezoneOptions } {
  return {
    ...options,
    storage: options.storage ?? { type: 'memory' },
    timezone: {
      type: options.timezone?.type ?? 'UTC',
      validate: options.timezone?.validate ?? true,
      strict: true,
    },
  };
}

export function createFlexibleModuleOptions(
  options: ModuleOptions & { timezone?: FlexibleTimezoneOptions },
): ModuleOptions & { timezone?: FlexibleTimezoneOptions } {
  return {
    ...options,
    storage: options.storage ?? { type: 'memory' },
    timezone: {
      type: options.timezone?.type ?? 'UTC',
      validate: options.timezone?.validate ?? true,
      strict: false,
    },
  };
}
