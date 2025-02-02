import { DateTime } from 'luxon'
import TimezoneUtils from '../utils/timezone'

import { EventEmitter } from 'node:events'
import type { CronTask, CronTaskEvent, TaskId, CronTaskOptions, FlexibleCronTaskOptions } from '../task/types'
import type { CronStorage } from '../storage/types'


import { type ParsedExpression } from '../expression'
import CronExpressionParser from '../expression/parser'


import type { SchedulerOptions, SchedulerStats, SchedulerBaseOptions } from './types'
import { TaskQueue } from './queue'

import { getModuleOptions } from './../config'
import { type ModuleOptions } from '../../module'



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
    }

    constructor(
        storage: CronStorage,
        moduleOptions: ModuleOptions,
        baseOptions: SchedulerBaseOptions = {},
    ) {
        super()
        if (moduleOptions.timezone?.validate && !TimezoneUtils.isValidTimezone(moduleOptions.timezone.type)) {
            throw new Error(`Invalid timezone: ${moduleOptions.timezone.type}`)
        }

        this.queue = new TaskQueue()
        this.storage = storage

        this.options = {
            ...baseOptions,
            timezone: moduleOptions.timezone,
        }

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
            this.queue.on(queueEvent as QueueEventType, (event: CronTaskEvent) => {
                switch (event.type) {
                    case 'completed':
                        this.updateNextRunTime(event.task)
                        break
                    case 'failed':
                        this.stats.totalTasksFailed++
                        break
                    case 'retry':
                        this.stats.totalTasksRetried++
                        break
                    case 'started':
                        this.stats.totalTasksRun++
                        break
                }
                this.emit(schedulerEvent, event)
            })
        })
    }

    protected handleError(method: string, error: unknown): Error {
        if (error instanceof Error) {
            return new Error(`${method}: ${error.message}`)
        }
        return new Error(`${method}: An unknown error occurred`)
    }

    async start(): Promise<void> {
        if (this.running) return

        try {
            await this.storage.init()
            await this.restore()

            this.running = true
            this.startTime = new Date()
            this.intervalId = setInterval(() => this.tick(), this.options.tickInterval)

            if (this.options.handleMissedTasks) {
                await this.handleMissedTasks()
            }
        }
        catch (error: unknown) {
            const wrappedError = this.handleError('Failed to start scheduler', error)
            this.emit('error', wrappedError)
            throw wrappedError
        }
    }

    async stop(): Promise<void> {
        if (!this.running) return

        try {
            this.running = false
            if (this.intervalId) {
                clearInterval(this.intervalId)
            }

            const activeTask = this.queue.getAll().filter(task =>
                task.status === 'running',
            )

            if (activeTask.length > 0) {
                await Promise.all(
                    activeTask.map(task => this.waitForTask(task.id)),
                )
            }

            await this.persist()
        }
        catch (error: unknown) {
            const wrappedError = this.handleError('Failed to stop scheduler', error)
            this.emit('error', wrappedError)
            throw wrappedError
        }
    }

    private getEffectiveTimezone(taskOptions: CronTaskOptions): string {
        if (this.options.timezone?.strict) {
            return this.options.timezone.type
        }
        return (taskOptions as FlexibleCronTaskOptions).timezone
            || this.options.timezone?.type
            || 'UTC'
    }

    async addTask(task: Omit<CronTask, 'id' | 'metadata'>): Promise<CronTask> {
        try {
            if (this.options.timezone?.strict && 'timezone' in task.options) {
                if (task.options.timezone !== this.options.timezone.type) {
                    throw new Error(
                        'Cannot set per-task timezone when timezone.strict is enabled. '
                        + 'Use the module-level timezone configuration instead.'
                    )
                }
            }

            const effectiveTimezone = this.getEffectiveTimezone(task.options)

            const newTask: CronTask = {
                ...task,
                id: crypto.randomUUID(),
                options: {
                    ...task.options,
                    timezone: effectiveTimezone,
                },
                metadata: {
                    runCount: 0,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            }

            const moduleOptions = getModuleOptions()

            CronExpressionParser.parseCronExpression(newTask.options.expression, {
                timezone: {
                    ...moduleOptions.timezone,
                    type: effectiveTimezone,
                },
                validateTimezone: this.options.timezone?.validate ?? true,
            })

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

    async removeTask(taskId: TaskId): Promise<void> {
        const removed = this.queue.remove(taskId)

        if (removed) {
            await this.persist()
        }
    }

    async pauseTask(taskId: TaskId): Promise<void> {
        this.queue.pause(taskId)
        await this.persist()
    }

    async resumeTask(taskId: TaskId): Promise<void> {
        const task = this.queue.get(taskId)

        if (task && task.status === 'paused') {
            this.queue.resume(taskId)
            task.metadata.nextRun = this.getNextRunTime(task)
            await this.persist()
        }
    }

    getTask(taskId: TaskId): CronTask | undefined {
        return this.queue.get(taskId)
    }

    getAllTasks(): CronTask[] {
        return this.queue.getAll()
    }

    getStats(): SchedulerStats {
        if (this.startTime) {
            this.stats.uptime = Date.now() - this.startTime.getTime()
        }

        return { ...this.stats }
    }

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
            }

            checkCompletion()
        })
    }

    public getNextRunTime(task: CronTask): Date {
        try {
            const effectiveTimezone = this.options.timezone?.strict
                ? this.options.timezone.type
                : (task.options.timezone || this.options.timezone?.type || 'UTC')

            const moduleOptions = getModuleOptions()

            const parsed = CronExpressionParser.parseCronExpression(task.options.expression, {
                timezone: {
                    ...moduleOptions.timezone,
                    type: effectiveTimezone,
                },
                validateTimezone: this.options.timezone?.validate ?? true,
            })
            return this.calculateNextRunTime(parsed)
        }
        catch (error: unknown) {
            const wrappedError = this.handleError(`Invalid cron expression for task ${task.id}`, error)
            this.emit('error', wrappedError)
            return new Date(Date.now() + 24 * 60 * 60 * 1000)
        }
    }

    private calculateNextRunTime(parsed: ParsedExpression): Date {
        const now = new Date()

        const tzNow = TimezoneUtils.convertTimezone(
            now,
            'UTC',
            parsed.timezone
        )

        if (typeof tzNow === 'string') {
            throw new Error('Unexpected string return from timezone conversion')
        }

        const candidate = new Date(tzNow.toJSDate())

        candidate.setSeconds(0)
        candidate.setMilliseconds(0)

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
        }

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
                    'UTC'
                )

                return TimezoneUtils.toJSDate(convertedTimezone)
            }

            candidate.setMinutes(candidate.getMinutes() + 1)
        }
    }

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
                    : (task.options.timezone || this.options.timezone?.type || 'UTC')

                const moduleOptions = getModuleOptions()

                const parsed = CronExpressionParser.parseCronExpression(task.options.expression, {
                    timezone: {
                        ...moduleOptions.timezone,
                        type: effectiveTimezone,
                    },
                    validateTimezone: this.options.timezone?.validate ?? true,
                })

                const tzNow = TimezoneUtils.convertTimezone(
                    now,
                    'UTC',
                    parsed.timezone
                )

                const tzNextRun = TimezoneUtils.convertTimezone(
                    task.metadata.nextRun,
                    'UTC',
                    parsed.timezone
                )

                if (typeof tzNow === 'string' || typeof tzNextRun === 'string') {
                    throw new Error('Unexpected string return from timezone conversion')
                }

                const shouldRun = tzNextRun.toJSDate() <= tzNow.toJSDate()
                return shouldRun
            })


            const currentRunning = tasks.filter(task => task.status === 'running').length
            const available = Math.max(0, this.options.maxConcurrent! - currentRunning)
            const toExecute = tasksToRun.slice(0, available)

            await Promise.all(
                toExecute.map(task => this.queue.executeTask(task.id))
            )
        }
        catch (error: unknown) {
            const wrappedError = this.handleError('Scheduler tick failed', error)
            this.emit('error', wrappedError)
        }
    }

    private updateNextRunTime(task: CronTask): void {
        task.metadata.nextRun = this.getNextRunTime(task)

        this.persist().catch((error: unknown) => {
            const wrappedError = this.handleError('Failed to persist task state', error)
            this.emit('error', wrappedError)
        })
    }

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
            const wrappedError = this.handleError('Failed to handle missed tasks', error)
            this.emit('error', wrappedError)
            throw wrappedError
        }
    }

    private updateStats(): void {
        this.stats.activeTasks = this.queue.getAll().filter(
            task => task.status === 'running',
        ).length

        this.stats.queuedTasks = this.queue.getAll().filter(
            task => task.status === 'pending',
        ).length
    }



    /**
     * Persist scheduler state to storage
     */
    private async persist(): Promise<void> {
        try {
            const tasks = this.queue.getAll()
            await Promise.all(tasks.map(async (task) => {
                const exsitingTask = await this.storage.get(task.id)

                if (exsitingTask) {
                    await this.storage.update(task.id, task)
                }
                else {
                    await this.storage.add(task)
                }
            }))
        }
        catch (error: unknown) {
            const wrappedError = this.handleError('Failed to persist scheduler state', error)
            this.emit('error', wrappedError)
            throw wrappedError
        }
    }

    /**
     * Restore scheduler state from storage
     */
    private async restore(): Promise<void> {
        try {
            const tasks = await this.storage.getAll()
            tasks.forEach(task => this.queue.add(task))
        }
        catch (error: unknown) {
            const wrappedError = this.handleError('Failed to restore scheduler state', error)
            this.emit('error', wrappedError)
            throw wrappedError
        }
    }
}