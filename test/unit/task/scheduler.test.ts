import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

import { defu } from 'defu'

import { Scheduler } from '../../../src/runtime/scheduler'
import { MemoryStorage } from '../../../src/runtime/storage'
import type { CronTask, CronTaskEvent } from '../../../src/runtime/task/types'
import type { ModuleOptions } from '../../../src/module'
import { moduleConfiguration } from '../../../src/runtime/config'

import type { FlexibleTimezoneOptions, StrictTimezoneOptions } from '../../../src/runtime/utils/timezone'
import type { SchedulerBaseOptions } from '../../../src/runtime/scheduler/types'



describe('Scheduler', () => {
    let scheduler: Scheduler
    let storage: MemoryStorage

    const createFlexibleOptions = (
        timezone: Partial<Omit<FlexibleTimezoneOptions, 'strict'>> = {},
    ): ModuleOptions => ({
        serverTasks: true,
        clientTasks: false,
        storage: {
            type: 'memory',
        },
        timezone: {
            type: timezone.type ?? 'UTC',
            validate: timezone.validate ?? true,
            strict: false,
        },
    })

    const createStrictOptions = (
        timezone: Partial<Omit<StrictTimezoneOptions, 'strict'>> = {},
    ): ModuleOptions => ({
        serverTasks: true,
        clientTasks: false,
        storage: {
            type: 'memory',
        },
        timezone: {
            type: timezone.type ?? 'UTC',
            validate: timezone.validate ?? true,
            strict: true,
        },
    })

    const setupScheduler = async (
        moduleOpts: ModuleOptions,
    ) => {
        storage = new MemoryStorage()
        await storage.init()
        await storage.clear()

        vi.spyOn(MemoryStorage.prototype, 'add')
        vi.spyOn(MemoryStorage.prototype, 'update')
        vi.spyOn(MemoryStorage.prototype, 'get')
        vi.spyOn(MemoryStorage.prototype, 'getAll')

        scheduler = new Scheduler(
            storage,
            moduleOpts,
            {
                tickInterval: 100,
                maxConcurrent: 2,
            },
        )

        return scheduler
    }

    afterEach(async () => {
        if (scheduler) {
            await scheduler.stop()
        }

        if (storage) {
            await storage.clear()
        }

        vi.clearAllMocks()
        vi.restoreAllMocks()
    })

    describe('timezone handling', () => {
        describe('strict mode', () => {
            beforeEach(async () => {
                const options = createStrictOptions({
                    type: 'UTC',
                })
                await setupScheduler(options)
            })

            it('should reject tasks with custom timezones in strict mode', async () => {
                await expect(scheduler.addTask({
                    name: 'test task',
                    status: 'pending',
                    options: {
                        expression: '* * * * *',
                        timezone: 'America/New_York',
                    },
                    execute: async () => 'test result',
                })).rejects.toThrow('Cannot set per-task timezone when timezone.strict is enabled')
            })

            it('should accept tasks without timezone in strict mode', async () => {
                const task = await scheduler.addTask({
                    name: 'test task',
                    status: 'pending',
                    options: {
                        expression: '* * * * *',
                    },
                    execute: async () => 'test result',
                })

                expect(task).toMatchObject({
                    name: 'test task',
                    options: {
                        expression: '* * * * *',
                    },
                })
            })
        })

        describe('flexible mode', () => {
            beforeEach(async () => {
                await setupScheduler(createFlexibleOptions({
                    type: 'UTC',
                }))
            })

            it('should accept tasks with custom timezones', async () => {
                const task = await scheduler.addTask({
                    name: 'test task',
                    status: 'pending',
                    options: {
                        expression: '* * * * *',
                        timezone: 'America/New_York',
                    },
                    execute: async () => 'test result',
                })

                expect(task.options.timezone).toBe('America/New_York')
            })

            it('should use module timezone as fallback', async () => {
                const task = await scheduler.addTask({
                    name: 'test task',
                    status: 'pending',
                    options: {
                        expression: '* * * * *',
                    },
                    execute: async () => 'test result',
                })

                expect(task.options.timezone).toBe('UTC')
            })

            it('should validate timezone format if validation is enabled', async () => {
                await setupScheduler(createFlexibleOptions({
                    type: 'UTC',
                    validate: true,
                }))

                await expect(scheduler.addTask({
                    name: 'test task',
                    status: 'pending',
                    options: {
                        expression: '* * * * *',
                        timezone: 'Invalid/Timezone',
                    },
                    execute: async () => 'test result',
                })).rejects.toThrow()
            })
        })

        describe('task execution', () => {
            it('should handle task failures and retries', async () => {
                const failureError = new Error('test failure')

                const testTask: CronTask = {
                    id: 'test-id',
                    name: 'failing task',
                    status: 'pending',
                    options: {
                        expression: '* * * * *',
                        maxRetries: 1,
                        retryDelay: 100,
                    },
                    execute: async () => {
                        throw failureError
                    },
                    metadata: {
                        runCount: 0,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                        nextRun: new Date(Date.now() - 1000),
                    },
                }

                vi.spyOn(storage, 'getAll').mockResolvedValue([testTask])
                vi.spyOn(storage, 'get').mockResolvedValue(testTask)
                vi.spyOn(storage, 'update').mockImplementation(async (id, updates) => ({
                    ...testTask,
                    ...updates,
                    id,
                }))

                const events: CronTaskEvent[] = []
                scheduler.on('task-failed', event => events.push(event))
                scheduler.on('task-retry', event => events.push(event))

                await scheduler.start()
                await new Promise(resolve => setTimeout(resolve, 500))
                await scheduler.stop()

                expect(events.filter(e => e.type === 'retry')).toHaveLength(1)
                expect(events.filter(e => e.type === 'failed')).toHaveLength(2)
            })

            let scheduler: Scheduler
            let storage: MemoryStorage

            const setupScheduler = async (
                baseOptions: SchedulerBaseOptions = {},
            ) => {
                storage = new MemoryStorage()
                await storage.init()
                await storage.clear()

                vi.spyOn(MemoryStorage.prototype, 'add')
                vi.spyOn(MemoryStorage.prototype, 'update')
                vi.spyOn(MemoryStorage.prototype, 'get')
                vi.spyOn(MemoryStorage.prototype, 'getAll')

                const moduleOptions = moduleConfiguration.getModuleOptions()

                scheduler = new Scheduler(
                    storage,
                    moduleOptions,
                    {
                        tickInterval: 100,
                        maxConcurrent: 2,
                        ...baseOptions,
                    },
                )
            }

            beforeEach(async () => {
                await setupScheduler()
            })

            afterEach(async () => {
                if (scheduler) {
                    await scheduler.stop()
                }

                if (storage) {
                    await storage.clear()
                }

                vi.clearAllMocks()
                vi.restoreAllMocks()
            })
        })

        describe('error handling', () => {
            it('should emit error events for timezone validation failures', async () => {
                const errorHandler = vi.fn()
                scheduler.on('error', errorHandler)

                await scheduler.addTask({
                    name: 'test task',
                    status: 'pending',
                    options: {
                        expression: '* * * * *',
                        timezone: 'Invalid/Timezone',
                    },
                    execute: async () => 'test',
                }).catch(() => { })

                expect(errorHandler).toHaveBeenCalled()
                expect(errorHandler.mock.calls[0][0].message).toContain('timezone')
            })

            it('should emit error events for invalid cron expressions', async () => {
                const errorHandler = vi.fn()
                scheduler.on('error', errorHandler)

                await scheduler.addTask({
                    name: 'test task',
                    status: 'pending',
                    options: {
                        expression: 'invalid cron',
                    },
                    execute: async () => 'test',
                }).catch(() => { })

                expect(errorHandler).toHaveBeenCalled()
            })
        })
    })

    describe('DST handling', () => {
        let mockExecute: ReturnType<typeof vi.fn>;

        beforeEach(async () => {
            vi.useFakeTimers();
            mockExecute = vi.fn().mockResolvedValue('test');

            storage = new MemoryStorage();
            await storage.init();
            await storage.clear();

            scheduler = new Scheduler(
                storage,
                {
                    serverTasks: true,
                    clientTasks: false,
                    storage: { type: 'memory' },
                    timezone: {
                        type: 'America/New_York',
                        validate: true,
                        strict: false,
                    }
                },
                {
                    tickInterval: 100,
                }
            );
        });

        afterEach(async () => {
            vi.useRealTimers();
            if (scheduler) {
                await scheduler.stop();
            }
            if (storage) {
                await storage.clear();
            }
            vi.clearAllMocks();
        });

        describe('DST transitions', () => {
            it('should maintain correct intervals across DST boundaries', async () => {
                vi.useFakeTimers();
                const startTime = new Date('2024-11-03T04:00:00.000Z');
                vi.setSystemTime(startTime);

                vi.spyOn(storage, 'getAll').mockResolvedValue([]);

                const task = await scheduler.addTask({
                    name: 'interval-test',
                    status: 'pending',
                    options: {
                        expression: '0 */2 * * *',
                        timezone: 'America/New_York'
                    },
                    execute: mockExecute
                });

                await scheduler.start();

                const intervals = [];
                let lastRun = startTime;

                for (let i = 0; i < 3; i++) {
                    await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000 + 1000);

                    const currentTime = new Date();
                    if (lastRun) {
                        const interval = (currentTime.getTime() - lastRun.getTime()) / (60 * 60 * 1000);
                        intervals.push(interval);
                    }
                    lastRun = currentTime;
                }

                intervals.forEach(interval => {
                    expect(Math.abs(interval - 2)).toBeLessThan(1);
                });

                await scheduler.stop();
            }, 120000);
        });

        describe('DST transitions', () => {
            beforeEach(() => {
                vi.useFakeTimers();
            });

            afterEach(() => {
                vi.useRealTimers();
            });

            it('should maintain correct intervals across DST boundaries', async () => {
                // Set start time to just before DST change
                const startTime = new Date('2024-11-03T04:00:00.000Z');
                vi.setSystemTime(startTime);

                vi.spyOn(storage, 'getAll').mockResolvedValue([]);

                const task = await scheduler.addTask({
                    name: 'interval-test',
                    status: 'pending',
                    options: {
                        expression: '0 */2 * * *',
                        timezone: 'America/New_York'
                    },
                    execute: mockExecute
                });

                await scheduler.start();

                // Test three 2-hour intervals
                const intervals = [];
                let lastRun = startTime;

                for (let i = 0; i < 3; i++) {
                    // Advance by exactly 2 hours
                    await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000);
                    const currentTime = new Date();
                    intervals.push((currentTime.getTime() - lastRun.getTime()) / (60 * 60 * 1000));
                    lastRun = currentTime;
                }

                // Verify intervals
                intervals.forEach(interval => {
                    expect(Math.abs(interval - 2)).toBeLessThan(0.1);
                });

                await scheduler.stop();
            }, 120000);
        });

        describe('timezone validation', () => {
            it('should validate ambiguous times during DST transitions', async () => {
                const task = await scheduler.addTask({
                    name: 'ambiguous-time-test',
                    status: 'pending',
                    options: {
                        expression: '0 1 * * *',
                        timezone: 'America/New_York'
                    },
                    execute: async () => 'test'
                })

                vi.setSystemTime(new Date('2024-11-03T05:00:00.000Z'))

                const nextRun = scheduler.getNextRunTime(task)
                expect(nextRun).toBeDefined()
                expect(nextRun.getTime()).toBe(new Date('2024-11-03T06:00:00.000Z').getTime())
            })
        })
    })

    describe('timezone handling with non-UTC defaults', () => {
        describe('strict mode with custom default timezone', () => {
            beforeEach(async () => {
                const strictOptions = createStrictOptions({
                    type: 'America/New_York',
                })

                await setupScheduler(strictOptions)
            })

            it('should use custom default timezone for tasks without timezone', async () => {
                const task = await scheduler.addTask({
                    name: 'test task',
                    status: 'pending',
                    options: {
                        expression: '* * * * *',
                    },
                    execute: async () => 'test result',
                })

                expect(task.options.timezone).toBe('America/New_York')
            })

            it('should reject tasks with different timezone than default in strict mode', async () => {
                await expect(scheduler.addTask({
                    name: 'test task',
                    status: 'pending',
                    options: {
                        expression: '* * * * *',
                        timezone: 'Europe/London',
                    },
                    execute: async () => 'test result',
                })).rejects.toThrow('Cannot set per-task timezone when timezone.strict is enabled')
            })

            it('should accept tasks explicitly using the default timezone', async () => {
                const task = await scheduler.addTask({
                    name: 'test task',
                    status: 'pending',
                    options: {
                        expression: '* * * * *',
                        timezone: 'America/New_York',
                    },
                    execute: async () => 'test result',
                })

                expect(task.options.timezone).toBe('America/New_York')
            })
        })

        describe('flexible mode with custom default timezone', () => {
            beforeEach(async () => {
                await setupScheduler(createFlexibleOptions({
                    type: 'Asia/Tokyo',
                }))
            })

            it('should use custom default timezone when no timezone specified', async () => {
                const task = await scheduler.addTask({
                    name: 'test task',
                    status: 'pending',
                    options: {
                        expression: '* * * * *',
                    },
                    execute: async () => 'test result',
                })

                expect(task.options.timezone).toBe('Asia/Tokyo')
            })

            it('should allow overriding default timezone with task-specific timezone', async () => {
                const task = await scheduler.addTask({
                    name: 'test task',
                    status: 'pending',
                    options: {
                        expression: '* * * * *',
                        timezone: 'Europe/Paris',
                    },
                    execute: async () => 'test result',
                })

                expect(task.options.timezone).toBe('Europe/Paris')
            })

            it('should validate custom timezone even with different default timezone', async () => {
                await setupScheduler(createFlexibleOptions({
                    type: 'Asia/Tokyo',
                    validate: true,
                }))

                await expect(scheduler.addTask({
                    name: 'test task',
                    status: 'pending',
                    options: {
                        expression: '* * * * *',
                        timezone: 'Invalid/Zone',
                    },
                    execute: async () => 'test result',
                })).rejects.toThrow()
            })
        })

        describe('timezone validation with different defaults', () => {
            it('should validate default timezone during scheduler initialization', async () => {
                await expect(setupScheduler(createFlexibleOptions({
                    type: 'Invalid/DefaultZone',
                    validate: true,
                }))).rejects.toThrow()
            })

            it('should handle timezone transitions correctly', async () => {
                await setupScheduler(createFlexibleOptions({
                    type: 'America/New_York',
                }))

                const task = await scheduler.addTask({
                    name: 'test task',
                    status: 'pending',
                    options: {
                        expression: '0 2 * * *',
                    },
                    execute: async () => 'test result',
                })

                expect(task.metadata.nextRun).toBeDefined()
                expect(task.options.timezone).toBe('America/New_York')
            })
        })
    })

    describe('Scheduler Task Management', () => {
        let scheduler: Scheduler
        let storage: MemoryStorage

        const setupScheduler = async () => {
            storage = new MemoryStorage()
            await storage.init()
            await storage.clear()

            const moduleOptions = moduleConfiguration.getModuleOptions()

            scheduler = new Scheduler(
                storage,
                moduleOptions,
                {
                    tickInterval: 100,
                    maxConcurrent: 2,
                },
            )
        }

        beforeEach(async () => {
            await setupScheduler()
        })

        afterEach(async () => {
            if (scheduler) {
                await scheduler.stop()
            }
            if (storage) {
                await storage.clear()
            }
            vi.clearAllMocks()
        })

        describe('pauseTask and resumeTask', () => {
            it('should pause a running task', async () => {
                const task = await scheduler.addTask({
                    name: 'test task',
                    status: 'pending',
                    options: {
                        expression: '* * * * *',
                    },
                    execute: async () => 'test result',
                })

                await scheduler.pauseTask(task.id)
                const pausedTask = scheduler.getTask(task.id)
                expect(pausedTask?.status).toBe('paused')
            })

            it('should resume a paused task', async () => {
                const task = await scheduler.addTask({
                    name: 'test task',
                    status: 'pending',
                    options: {
                        expression: '* * * * *',
                    },
                    execute: async () => 'test result',
                })

                await scheduler.pauseTask(task.id)
                await scheduler.resumeTask(task.id)
                const resumedTask = scheduler.getTask(task.id)
                expect(resumedTask?.status).toBe('pending')
                expect(resumedTask?.metadata.nextRun).toBeDefined()
            })

            it('should not resume a non-paused task', async () => {
                const task = await scheduler.addTask({
                    name: 'test task',
                    status: 'pending',
                    options: {
                        expression: '* * * * *',
                    },
                    execute: async () => 'test result',
                })

                const originalNextRun = task.metadata.nextRun
                await scheduler.resumeTask(task.id)
                const unchangedTask = scheduler.getTask(task.id)
                expect(unchangedTask?.metadata.nextRun).toEqual(originalNextRun)
            })
        })

        describe('getTask and getAllTasks', () => {
            it('should get a specific task by ID', async () => {
                const task = await scheduler.addTask({
                    name: 'test task',
                    status: 'pending',
                    options: {
                        expression: '* * * * *',
                    },
                    execute: async () => 'test result',
                })

                const retrievedTask = scheduler.getTask(task.id)
                expect(retrievedTask).toEqual(task)
            })

            it('should return undefined for non-existent task ID', () => {
                const nonExistentTask = scheduler.getTask('non-existent-id')
                expect(nonExistentTask).toBeUndefined()
            })

            it('should get all tasks', async () => {
                const task1 = await scheduler.addTask({
                    name: 'task 1',
                    status: 'pending',
                    options: {
                        expression: '* * * * *',
                    },
                    execute: async () => 'test result 1',
                })

                const task2 = await scheduler.addTask({
                    name: 'task 2',
                    status: 'pending',
                    options: {
                        expression: '*/5 * * * *',
                    },
                    execute: async () => 'test result 2',
                })

                const allTasks = scheduler.getAllTasks()
                expect(allTasks).toHaveLength(2)
                expect(allTasks).toEqual(expect.arrayContaining([task1, task2]))
            })
        })

        describe('getStats', () => {
            it('should return current statistics', async () => {
                await scheduler.start()
                const stats = scheduler.getStats()

                expect(stats).toEqual(expect.objectContaining({
                    totalTasksRun: expect.any(Number),
                    totalTasksFailed: expect.any(Number),
                    totalTasksRetried: expect.any(Number),
                    activeTasks: expect.any(Number),
                    queuedTasks: expect.any(Number),
                    uptime: expect.any(Number),
                }))
            })

            it('should calculate correct uptime', async () => {
                vi.useFakeTimers()
                const startTime = new Date()
                vi.setSystemTime(startTime)

                await scheduler.start()
                vi.advanceTimersByTime(5000) // Advance 5 seconds

                const stats = scheduler.getStats()
                expect(stats.uptime).toBe(5000)

                vi.useRealTimers()
            })
        })

        describe('waitForTask', () => {
            it('should wait for a running task to complete', async () => {
                vi.useFakeTimers() // Enable fake timers

                let taskCompleted = false
                const task = await scheduler.addTask({
                    name: 'long running task',
                    status: 'pending',
                    options: {
                        expression: '* * * * *',
                    },
                    execute: async () => {
                        await new Promise(resolve => setTimeout(resolve, 200))
                        taskCompleted = true
                        return 'test result'
                    },
                })

                // Set nextRun to now
                task.metadata.nextRun = new Date()

                await scheduler.start()

                // Advance virtual time past the tick interval to trigger task execution
                await vi.advanceTimersByTimeAsync(100) // Advance past tick interval

                // Advance virtual time past the task's setTimeout
                await vi.advanceTimersByTimeAsync(200)

                // Wait for task completion
                await (scheduler as any).waitForTask(task.id)

                expect(taskCompleted).toBe(true)

                vi.useRealTimers() // Cleanup
            })

            it('should resolve immediately for non-existent tasks', async () => {
                const waitPromise = (scheduler as any).waitForTask('non-existent-id')
                await expect(waitPromise).resolves.toBeUndefined()
            })
        })

        describe('handleMissedTasks', () => {
            it('should execute missed tasks with catchUp enabled', async () => {
                const executeMock = vi.fn().mockResolvedValue('test result')
                const pastDate = new Date(Date.now() - 60000) // 1 minute ago

                const task = await scheduler.addTask({
                    name: 'missed task',
                    status: 'pending',
                    options: {
                        expression: '* * * * *',
                        catchUp: true,
                    },
                    execute: executeMock,
                })

                // Manually set next run time to the past
                task.metadata.nextRun = pastDate

                await (scheduler as any).handleMissedTasks()
                expect(executeMock).toHaveBeenCalled()
            })

            it('should not execute missed tasks with catchUp disabled', async () => {
                const executeMock = vi.fn().mockResolvedValue('test result')
                const pastDate = new Date(Date.now() - 60000)

                const task = await scheduler.addTask({
                    name: 'missed task',
                    status: 'pending',
                    options: {
                        expression: '* * * * *',
                        catchUp: false,
                    },
                    execute: executeMock,
                })

                task.metadata.nextRun = pastDate

                await (scheduler as any).handleMissedTasks()
                expect(executeMock).not.toHaveBeenCalled()
            })

            it('should handle errors during missed task execution', async () => {
                vi.useFakeTimers()
                const errorHandler = vi.fn()
                scheduler.on('error', errorHandler)

                const testError = new Error('Test error')
                const failedTaskHandler = vi.fn()
                scheduler.on('task-failed', failedTaskHandler)

                const task = await scheduler.addTask({
                    name: 'error task',
                    status: 'pending',
                    options: {
                        expression: '* * * * *',
                        catchUp: true,
                    },
                    execute: async () => {
                        throw testError
                    },
                })

                task.metadata.nextRun = new Date(Date.now() - 60000)
                scheduler['options'].handleMissedTasks = true

                await (scheduler as any).handleMissedTasks()

                // Verify task failed event was emitted
                expect(failedTaskHandler).toHaveBeenCalledWith(
                    expect.objectContaining({
                        type: 'failed',
                        task: expect.objectContaining({ id: task.id }),
                        error: testError
                    })
                )

                vi.useRealTimers()
            })
        })

        describe('restore functionality', () => {
            it('should properly restore tasks from storage', async () => {
                // Add a task before starting scheduler
                const task = await scheduler.addTask({
                    name: 'test task',
                    status: 'pending',
                    options: {
                        expression: '* * * * *',
                    },
                    execute: async () => 'test result',
                })

                // Stop scheduler (which persists state)
                await scheduler.stop()

                // Clear queue manually to simulate restart
                scheduler['queue'].clear()

                // Start scheduler (which triggers restore)
                await scheduler.start()

                // Verify task was restored
                const restoredTask = scheduler.getTask(task.id)
                expect(restoredTask).toBeDefined()
                expect(restoredTask?.id).toBe(task.id)
            })

            it('should handle empty storage during restore', async () => {
                // Clear storage
                await storage.clear()

                // Start scheduler (which triggers restore)
                await scheduler.start()

                // Verify no tasks
                expect(scheduler.getAllTasks()).toHaveLength(0)
            })

            it('should handle multiple restores gracefully', async () => {
                // Add initial task
                const task = await scheduler.addTask({
                    name: 'test task',
                    status: 'pending',
                    options: {
                        expression: '* * * * *',
                    },
                    execute: async () => 'test result',
                })

                // Multiple stop/start cycles
                await scheduler.stop()
                await scheduler.start()
                await scheduler.stop()
                await scheduler.start()

                // Verify task still exists and is unique
                const allTasks = scheduler.getAllTasks()
                expect(allTasks).toHaveLength(1)
                expect(allTasks[0].id).toBe(task.id)
            })
        })
    })
})