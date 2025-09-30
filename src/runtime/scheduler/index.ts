import { EventEmitter } from 'node:events'
import { DateTime } from 'luxon'
import TimezoneUtils from '../utils/timezone'

import type {
        CronTask,
        CronTaskEvent,
        TaskId,
        CronTaskOptions,
        FlexibleCronTaskOptions,
} from '../task/types'
import type { CronStorage } from '../storage/types'

import type { ParsedExpression } from '../expression'
import CronExpressionParser from '../expression/parser'

import type { ModuleOptions } from '../../module'
import { moduleConfiguration } from '../config'
import type {
        SchedulerOptions,
        SchedulerStats,
        SchedulerBaseOptions,
} from './types'
import { TaskQueue } from './queue'

/**
 * @class Scheduler
 * @extends EventEmitter
 * @description Main scheduler class that handles cron task execution and management
 *
 * @fires Scheduler#task-started - Emitted when a task starts execution
 * @fires Scheduler#task-completed - Emitted when a task completes successfully
 * @fires Scheduler#task-failed - Emitted when a task fails during execution
 * @fires Scheduler#task-retry - Emitted when a task is being retried
 * @fires Scheduler#task-paused - Emitted when a task is paused
 * @fires Scheduler#task-resumed - Emitted when a task is resumed
 * @fires Scheduler#error - Emitted when an error occurs in the scheduler
 */
export class Scheduler extends EventEmitter {
        private readonly options: SchedulerOptions
  private queue: TaskQueue
  private storage: CronStorage
  private intervalId?: NodeJS.Timeout
  private running: boolean = false
  private startTime?: Date
  private stats: SchedulerStats = {
                totalTasksRun: 0,
                totalTasksFailed: 0,
                totalTasksRetried: 0,
                activeTasks: 0,
                queuedTasks: 0,
                uptime: 0,
        };

        constructor(
                storage: CronStorage,
                moduleOptions: ModuleOptions,
                baseOptions: SchedulerBaseOptions = {},
  ) {
                super()
    if (
                        moduleOptions.timezone?.validate
      && !TimezoneUtils.isValidTimezone(moduleOptions.timezone)
                ) {
                        throw new Error(`Invalid timezone: ${moduleOptions.timezone.type}`)
    }

                this.queue = new TaskQueue()
    this.storage = storage

    this.options = {
                        ...baseOptions,
                        timezone: moduleOptions.timezone,
                };

                this.setupEventForwarding()
  }

        private setupEventForwarding(): void {
        type QueueEventType = CronTaskEvent['type']
        type SchedulerEventType = `task-${QueueEventType}`

        const eventMapping: Record<QueueEventType, SchedulerEventType> = {
                started: 'task-started',
                completed: 'task-completed',
                failed: 'task-failed',
                retry: 'task-retry',
                paused: 'task-paused',
                resumed: 'task-resumed',
        } as const

        Object.entries(eventMapping).forEach(([queueEvent, schedulerEvent]) => {
                this.queue.on(
            queueEvent as QueueEventType,
            (event: CronTaskEvent) => {
                    switch (event.type) {
                            case 'completed':
                                    this.updateNextRunTime(event.task)
                  break;
                            case 'failed':
                                    this.stats.totalTasksFailed++
                  break;
                            case 'retry':
                                    this.stats.totalTasksRetried++
                  break;
                            case 'started':
                                    this.stats.totalTasksRun++
                  break;
                    }
                    this.emit(schedulerEvent, event)
            },
          );
        })
  }

        /**
     * Handles and wraps errors with context
     *
     * @private
     * @param {string} method - The method where the error occurred
     * @param {unknown} error - The original error
     * @returns {Error} Wrapped error with context
     */
        protected handleError(method: string, error: unknown): Error {
                if (error instanceof Error) {
                        return new Error(`${method}: ${error.message}`)
    }
                return new Error(`${method}: An unknown error occurred`)
  }

        /**
     * Starts the scheduler
     *
     * @throws {Error} If the scheduler fails to start
     * @returns {Promise<void>}
     */
        async start(): Promise<void> {
                if (this.running) return

    try {
                        await this.storage.init()
      await this.restore()

      this.running = true
      this.startTime = new Date()
      this.intervalId = setInterval(
                                () => this.tick(),
                                this.options.tickInterval,
      );

                        if (this.options.handleMissedTasks) {
                                await this.handleMissedTasks()
      }
                }
    catch (error: unknown) {
                        const wrappedError = this.handleError(
                                "Failed to start scheduler",
                                error
                        );
                        this.emit('error', wrappedError)
      throw wrappedError
    }
        }

        /**
     * Stops the scheduler
     *
     * @throws {Error} If the scheduler fails to stop
     * @returns {Promise<void>}
     */
        async stop(): Promise<void> {
                if (!this.running) return

    try {
                        this.running = false
      if (this.intervalId) {
                                clearInterval(this.intervalId)
      }

                        const activeTask = this.queue
                                .getAll()
                                .filter(task => task.status === 'running')

      if (activeTask.length > 0) {
                                await Promise.all(
                                        activeTask.map(task => this.waitForTask(task.id)),
        );
                        }

                        await this.persist()
    }
                catch (error: unknown) {
                        const wrappedError = this.handleError(
                                "Failed to stop scheduler",
                                error
                        );
                        this.emit('error', wrappedError)
      throw wrappedError
    }
        }

        /**
     * Get the active timezone for a task
     * @param {ModuleOptions} moduleOptions - The module options
     * @param {CronTaskOptions} taskOptions - The task options
     * @returns {Zone} - The active Luxon timezone
     * @throws {Error} If the timezone is invalid
     */
        public getActiveTimezone(taskOptions: CronTaskOptions): string {
                const moduleOptions = moduleConfiguration.getModuleOptions()

    if (moduleOptions.timezone.strict && !process.env.VITEST) {
                        const globalTimezone = moduleOptions.timezone.type

      const dt = DateTime.local().setZone(globalTimezone)
      if (!dt.isValid) {
                                throw new Error(`Invalid timezone: ${globalTimezone}`)
      }

                        return globalTimezone
    }
                else {
                        const inputTimezone
                = taskOptions.timezone || this.options.timezone.type

      const dt = DateTime.local().setZone(inputTimezone)
      if (!dt.isValid) {
                                throw new Error(`Invalid timezone: ${inputTimezone}`)
      }

                        return inputTimezone
    }
        }

        /**
     * Adds a new task to the scheduler
     *
     * @param {Omit<CronTask, 'id' | 'metadata'>} task - Task configuration without id and metadata
     * @returns {Promise<CronTask>} The complete task object with generated id and metadata
     * @throws {Error} If the task addition fails or timezone configuration is invalid
     */
        async addTask(
                task: Omit<CronTask, 'id' | 'metadata' | 'status'>,
  ): Promise<CronTask> {
                try {
                        if (this.options.timezone?.strict && 'timezone' in task.options) {
                                if (task.options.timezone !== this.options.timezone.type) {
                                        throw new Error(
                                                "Cannot set per-task timezone when timezone.strict is enabled. "
            + 'Use the module-level timezone configuration instead.',
          );
                                }
                        }

                        const activeTimezone = this.getActiveTimezone(task.options)

      const newTask: CronTask = {
                                ...task,
                                status: 'pending',
                                id: crypto.randomUUID(),
                                options: {
                                        ...task.options,
                                        timezone: activeTimezone,
                                },
                                metadata: {
                                        runCount: 0,
                                        createdAt: new Date(),
                                        updatedAt: new Date(),
                                },
                        };

                        const moduleOptions: ModuleOptions
                = moduleConfiguration.getModuleOptions()

      CronExpressionParser.parseCronExpression(
                                newTask.options.expression,
                                {
                                        timezone: {
                                                ...moduleOptions.timezone,
                                                type: activeTimezone,
                                        },
                                        validateTimezone: this.options.timezone?.validate ?? true,
                                }
                        );

                        newTask.metadata.nextRun = this.getNextRunTime(newTask)

      this.queue.add(newTask)
      await this.persist()

      return newTask
    }
                catch (error: unknown) {
                        const wrappedError = this.handleError('Failed to add task', error)
      this.emit('error', wrappedError)
      throw wrappedError
    }
        }

        /**
     * Removes a task from the scheduler
     *
     * @param {TaskId} taskId - The ID of the task to remove
     * @returns {Promise<void>}
     */
        async removeTask(taskId: TaskId): Promise<void> {
                const removed = this.queue.remove(taskId)

    if (removed) {
                        await this.persist()
    }
        }

        /**
     * Pauses a task
     *
     * @param {TaskId} taskId - The ID of the task to pause
     * @returns {Promise<void>}
     */
        async pauseTask(taskId: TaskId): Promise<void> {
                this.queue.pause(taskId)
    await this.persist()
  }

        /**
     * Resumes a paused task
     *
     * @param {TaskId} taskId - The ID of the task to resume
     * @returns {Promise<void>}
     */
        async resumeTask(taskId: TaskId): Promise<void> {
                const task = this.queue.get(taskId)

    if (task && task.status === 'paused') {
                        this.queue.resume(taskId)
      task.metadata.nextRun = this.getNextRunTime(task)
      await this.persist()
    }
        }

        /**
     * Gets a task by ID
     *
     * @param {TaskId} taskId - The ID of the task to retrieve
     * @returns {CronTask | undefined} The task if found, undefined otherwise
     */
        getTask(taskId: TaskId): CronTask | undefined {
                return this.queue.get(taskId)
  }

        /**
     * Gets all tasks in the scheduler
     *
     * @returns {CronTask[]} Array of all tasks
     */
        getAllTasks(): CronTask[] {
                return this.queue.getAll()
  }

        /**
     * Gets current scheduler statistics
     *
     * @returns {SchedulerStats} Current scheduler statistics
     */
        getStats(): SchedulerStats {
                if (this.startTime) {
                        this.stats.uptime = Date.now() - this.startTime.getTime()
    }

                return { ...this.stats }
  }

        /**
     * Waits for a task to complete
     *
     * @private
     * @param {TaskId} taskId - The ID of the task to wait for
     * @returns {Promise<void>} Resolves when the task completes or is no longer running
     */
        private waitForTask(taskId: TaskId): Promise<void> {
                return new Promise((resolve) => {
                        const checkCompletion = () => {
                                const task = this.queue.get(taskId)

        if (!task || task.status !== 'running') {
                                        resolve()
        }
                                else {
                                        setTimeout(checkCompletion, 100)
        }
                        };

                        checkCompletion()
    })
  }

        /**
     * Calculates the next run time for a task
     *
     * @param {CronTask} task - The task to calculate next run time for
     * @returns {Date} The next scheduled run time
     * @throws {Error} If the cron expression is invalid
     */
        public getNextRunTime(task: CronTask): Date {
                try {
                        const effectiveTimezone = this.options.timezone?.strict
                                ? this.options.timezone.type
                                : task.options.timezone || this.options.timezone?.type || 'UTC'

      const moduleOptions: ModuleOptions
                = moduleConfiguration.getModuleOptions()

      const parsed = CronExpressionParser.parseCronExpression(
                                task.options.expression,
                                {
                                        timezone: {
                                                ...moduleOptions.timezone,
                                                type: effectiveTimezone,
                                        },
                                        validateTimezone: this.options.timezone?.validate ?? true,
                                }
                        );
                        return this.calculateNextRunTime(parsed)
    }
                catch (error: unknown) {
                        const wrappedError = this.handleError(
                                `Invalid cron expression for task ${task.id}`,
                                error
                        );
                        this.emit('error', wrappedError)
      return new Date(Date.now() + 24 * 60 * 60 * 1000)
    }
        }

        /**
     * Calculates the next valid run time based on a parsed cron expression
     *
     * @private
     * @param {ParsedExpression} parsed - The parsed cron expression
     * @returns {Date} The next valid run time
     * @throws {Error} If timezone conversion fails
     */
        private calculateNextRunTime(parsed: ParsedExpression): Date {
                const now = new Date()

    const tzNow = TimezoneUtils.convertTimezone(
                        now,
                        "UTC",
                        parsed.timezone,
    );

                if (typeof tzNow === 'string') {
                        throw new TypeError(
                                "Unexpected string return from timezone conversion"
                        );
                }

                const candidate = new Date(tzNow.toJSDate())

    candidate.setSeconds(0)
    candidate.setMilliseconds(0)

    candidate.setMinutes(candidate.getMinutes() + 1)

    const hourFormatter = new Intl.DateTimeFormat('en-US', {
                        timeZone: parsed.timezone,
                        hour: 'numeric',
                        hour12: false,
                })

    const minuteFormatter = new Intl.DateTimeFormat('en-US', {
                        timeZone: parsed.timezone,
                        minute: 'numeric',
                })

    const monthFormatter = new Intl.DateTimeFormat('en-US', {
                        timeZone: parsed.timezone,
                        month: 'numeric',
                })

    const dayFormatter = new Intl.DateTimeFormat('en-US', {
                        timeZone: parsed.timezone,
                        day: 'numeric',
                })

    const weekdayFormatter = new Intl.DateTimeFormat('en-US', {
                        timeZone: parsed.timezone,
                        weekday: 'long',
                })

    const weekdayMap: Record<string, number> = {
                        Sunday: 0,
                        Monday: 1,
                        Tuesday: 2,
                        Wednesday: 3,
                        Thursday: 4,
                        Friday: 5,
                        Saturday: 6,
                };

                while (true) {
                        const hour = Number.parseInt(hourFormatter.format(candidate))
      const minute = Number.parseInt(minuteFormatter.format(candidate))
      const month = Number.parseInt(monthFormatter.format(candidate))
      const dayOfMonth = Number.parseInt(dayFormatter.format(candidate))
      const dayOfWeek = weekdayMap[weekdayFormatter.format(candidate)]

      if (
                                parsed.minute.includes(minute)
        && parsed.hour.includes(hour)
                                && parsed.dayOfMonth.includes(dayOfMonth)
        && parsed.month.includes(month)
                                && parsed.dayOfWeek.includes(dayOfWeek)
        && candidate > tzNow.toJSDate()
                        ) {
                                const convertedTimezone = TimezoneUtils.convertTimezone(
                                        candidate,
                                        parsed.timezone,
                                        "UTC"
                                );

                                return TimezoneUtils.toJSDate(convertedTimezone)
      }

                        candidate.setMinutes(candidate.getMinutes() + 1)
    }
        }

        /**
     * Executes the scheduler tick to check and run due tasks
     *
     * @private
     * @returns {Promise<void>}
     */
        private async tick(): Promise<void> {
                if (!this.running) return

    try {
                        const now = new Date()
      this.updateStats()

      const tasks = this.queue.getAll()

      const tasksToRun = tasks.filter((task) => {
                                if (
                                        task.status === 'paused'
          || !task.metadata.nextRun
                                        || this.queue.isRunning(task.id)
                                ) {
                                        return false
        }

                                const effectiveTimezone = this.options.timezone?.strict
                                        ? this.options.timezone.type
                                        : task.options.timezone
            || this.options.timezone?.type
                                          || 'UTC'

        const moduleOptions = moduleConfiguration.getModuleOptions()
        const parsed = CronExpressionParser.parseCronExpression(
                                        task.options.expression,
                                        {
                                                timezone: {
                                                        ...moduleOptions.timezone,
                                                        type: effectiveTimezone,
                                                },
                                                validateTimezone:
                            this.options.timezone?.validate ?? true,
                                        }
                                );

                                const tzNow = TimezoneUtils.convertTimezone(
                                        now,
                                        "UTC",
                                        parsed.timezone,
        );
                                const tzNextRun = TimezoneUtils.convertTimezone(
                                        task.metadata.nextRun,
                                        "UTC",
                                        parsed.timezone,
        );
                                if (
                                        typeof tzNow === 'string'
          || typeof tzNextRun === 'string'
                                ) {
                                        throw new TypeError(
                                                "Unexpected string return from timezone conversion"
                                        );
                                }

                                const isDue = tzNextRun.toJSDate() <= tzNow.toJSDate()

        return isDue
      })

      // Respect max concurrency
      const currentRunning = tasks.filter(
                                (task) => task.status === 'running',
      ).length
      const available = Math.max(
                                0,
        this.options.maxConcurrent! - currentRunning,
      );
                        const toExecute = tasksToRun.slice(0, available)

      // Execute due tasks in parallel and wait for completion
      await Promise.all(
                                toExecute.map(async (task) => {
                                        await this.queue.executeTask(task.id)
          const executedTask = this.queue.get(task.id)
          if (executedTask) {
                                                executedTask.metadata.nextRun
                            = this.getNextRunTime(executedTask)
          }
                                }),
      );
                }
    catch (error: unknown) {
                        const wrappedError = this.handleError(
                                "Scheduler tick failed",
                                error
                        );
                        this.emit('error', wrappedError)
    }
        }

        /**
     * Updates the next run time for a task and persists the change
     *
     * @private
     * @param {CronTask} task - The task to update
     */
        private updateNextRunTime(task: CronTask): void {
                task.metadata.nextRun = this.getNextRunTime(task)

    this.persist().catch((error: unknown) => {
                        const wrappedError = this.handleError(
                                "Failed to persist task state",
                                error
                        );
                        this.emit('error', wrappedError)
    })
  }

        /**
     * Handles tasks that were missed during scheduler downtime
     *
     * @private
     * @returns {Promise<void>}
     * @throws {Error} If handling missed tasks fails
     * @description Executes any tasks that were scheduled to run during downtime
     * if their catchUp option is enabled
     */
        private async handleMissedTasks(): Promise<void> {
                try {
                        const now = new Date()
      const tasks = this.queue.getAll()

      for (const task of tasks) {
                                if (
                                        task.options.catchUp
          && task.metadata.nextRun
                                        && task.metadata.nextRun < now
                                ) {
                                        await this.queue.executeTask(task.id)
          task.metadata.nextRun = this.getNextRunTime(task)
        }
                        }
                }
    catch (error: unknown) {
                        const wrappedError = this.handleError(
                                "Failed to handle missed tasks",
                                error
                        );
                        this.emit('error', wrappedError)
      throw wrappedError
    }
        }

        /**
     * Updates the scheduler's internal statistics
     *
     * @private
     * @description Updates the count of active and queued tasks
     */
        private updateStats(): void {
                this.stats.activeTasks = this.queue
                        .getAll()
                        .filter(task => task.status === 'running').length

    this.stats.queuedTasks = this.queue
                        .getAll()
                        .filter(task => task.status === 'pending').length
  }

        /**
     * Updates the scheduler's internal statistics
     *
     * @private
     * @description Updates the count of active and queued tasks
     */
        private async persist(): Promise<void> {
                try {
                        const tasks = this.queue.getAll()
      await Promise.all(
                                tasks.map(async (task) => {
                                        const exsitingTask = await this.storage.get(task.id)

          if (exsitingTask) {
                                                await this.storage.update(task.id, task)
          }
                                        else {
                                                await this.storage.add(task)
          }
                                }),
      );
                }
    catch (error: unknown) {
                        const wrappedError = this.handleError(
                                "Failed to persist scheduler state",
                                error
                        );
                        this.emit('error', wrappedError)
      throw wrappedError
    }
        }

        /**
     * Restores scheduler state from storage
     *
     * @private
     * @returns {Promise<void>}
     * @throws {Error} If restoration fails
     * @description Loads all tasks from storage and adds them to the queue
     */
        private async restore(): Promise<void> {
                try {
                        this.queue.clear()
      const tasks = await this.storage.getAll()
      tasks.forEach(task => this.queue.add(task))
    }
                catch (error: unknown) {
                        const wrappedError = this.handleError(
                                "Failed to restore scheduler state",
                                error
                        );
                        this.emit('error', wrappedError)
      throw wrappedError
    }
        }
}

export type {
        CronTask,
        CronTaskEvent,
        TaskId,
        CronTaskOptions,
        FlexibleCronTaskOptions,
        CronStorage,
        ParsedExpression,
        SchedulerOptions,
        SchedulerStats,
        SchedulerBaseOptions,
        ModuleOptions,
}
