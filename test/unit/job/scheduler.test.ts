import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

import { Scheduler } from '../../../src/runtime/utils/job/scheduler'
import { MemoryStorage } from '../../../src/runtime/utils/storage/environment/memory'
import type { CronJob, JobEvent } from '../../../src/runtime/utils/job/types'
import type { ModuleOptions } from './../../../src/module'
import { getModuleOptions, setModuleOptions, resetModuleOptions } from './../../../src/runtime/utils/config'

import type { FlexibleTimezoneOptions, StrictTimezoneOptions } from '~/src/runtime/utils/timezone'
import type { SchedulerBaseOptions } from '~/src/runtime/utils/job/scheduler/types'



describe('Scheduler', () => {
    let scheduler: Scheduler
    let storage: MemoryStorage
  
    const createFlexibleOptions = (
        timezone: Partial<Omit<FlexibleTimezoneOptions, 'strict'>> = {},
    ): ModuleOptions => ({
        serverJobs: true,
        clientJobs: false,
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
        serverJobs: true,
        clientJobs: false,
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
        moduleOpts: Partial<ModuleOptions> = {},
        baseOptions: SchedulerBaseOptions = {},
    ) => {
        resetModuleOptions()
        setModuleOptions(moduleOpts as ModuleOptions)
        
        storage = new MemoryStorage()
        await storage.init()
        await storage.clear()
    
        vi.spyOn(MemoryStorage.prototype, 'add')
        vi.spyOn(MemoryStorage.prototype, 'update')
        vi.spyOn(MemoryStorage.prototype, 'get')
        vi.spyOn(MemoryStorage.prototype, 'getAll')
    
        scheduler = new Scheduler(
            storage,
            getModuleOptions(),
            {
                tickInterval: 100,
                maxConcurrent: 2,
                ...baseOptions,
            },
        )
    }
  
    beforeEach(async () => {
        resetModuleOptions()
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
        resetModuleOptions()
    })

    describe('timezone handling', () => {
        describe('strict mode', () => {
            beforeEach(async () => {
                await setupScheduler(createStrictOptions({
                    type: 'UTC',
                }))
            })

            it('should reject jobs with custom timezones in strict mode', async () => {
                await expect(scheduler.addJob({
                name: 'test job',
                status: 'pending',
                options: {
                    expression: '* * * * *',
                    timezone: 'America/New_York',
                },
                execute: async () => 'test result',
                })).rejects.toThrow('Cannot set per-job timezone when timezone.strict is enabled')
            })

            it('should accept jobs without timezone in strict mode', async () => {
                const job = await scheduler.addJob({
                    name: 'test job',
                    status: 'pending',
                    options: {
                        expression: '* * * * *',
                    },
                    execute: async () => 'test result',
                })

                expect(job).toMatchObject({
                    name: 'test job',
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

            it('should accept jobs with custom timezones', async () => {
                const job = await scheduler.addJob({
                    name: 'test job',
                    status: 'pending',
                    options: {
                        expression: '* * * * *',
                        timezone: 'America/New_York',
                    },
                    execute: async () => 'test result',
                })

                expect(job.options.timezone).toBe('America/New_York')
            })

            it('should use module timezone as fallback', async () => {
                const job = await scheduler.addJob({
                    name: 'test job',
                    status: 'pending',
                    options: {
                        expression: '* * * * *',
                    },
                    execute: async () => 'test result',
                })

                expect(job.options.timezone).toBe('UTC')
            })

            it('should validate timezone format if validation is enabled', async () => {
                await setupScheduler(createFlexibleOptions({
                    type: 'UTC',
                    validate: true,
                }))

                await expect(scheduler.addJob({
                    name: 'test job',
                    status: 'pending',
                    options: {
                        expression: '* * * * *',
                        timezone: 'Invalid/Timezone',
                    },
                    execute: async () => 'test result',
                })).rejects.toThrow()
            })
        })

        describe('job execution', () => {
            it('should handle job failures and retries', async () => {
                let attempts = 0
                const failureError = new Error('test failure')

                const testJob: CronJob = {
                    id: 'test-id',
                    name: 'failing job',
                    status: 'pending',
                    options: {
                        expression: '* * * * *',
                        maxRetries: 1,
                        retryDelay: 100,
                    },
                    execute: async () => {
                        attempts++
                        throw failureError
                    },
                    metadata: {
                        runCount: 0,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                        nextRun: new Date(Date.now() - 1000),
                    },
                }

                vi.spyOn(storage, 'getAll').mockResolvedValue([testJob])
                vi.spyOn(storage, 'get').mockResolvedValue(testJob)
                vi.spyOn(storage, 'update').mockImplementation(async (id, updates) => ({
                    ...testJob,
                    ...updates,
                    id,
                }))

                const events: JobEvent[] = []
                scheduler.on('job-failed', event => events.push(event))
                scheduler.on('job-retry', event => events.push(event))

                await scheduler.start()
                await new Promise(resolve => setTimeout(resolve, 500))
                await scheduler.stop()

                expect(attempts).toBe(2)
                expect(events.filter(e => e.type === 'retry')).toHaveLength(1)
                expect(events.filter(e => e.type === 'failed')).toHaveLength(1)
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

                const moduleOptions = getModuleOptions() as ModuleOptions

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

                await scheduler.addJob({
                    name: 'test job',
                    status: 'pending',
                    options: {
                        expression: '* * * * *',
                        timezone: 'Invalid/Timezone',
                    },
                    execute: async () => 'test',
                }).catch(() => {})

                expect(errorHandler).toHaveBeenCalled()
                expect(errorHandler.mock.calls[0][0].message).toContain('timezone')
            })

            it('should emit error events for invalid cron expressions', async () => {
                const errorHandler = vi.fn()
                scheduler.on('error', errorHandler)

                await scheduler.addJob({
                    name: 'test job',
                    status: 'pending',
                    options: {
                    expression: 'invalid cron',
                    },
                    execute: async () => 'test',
                }).catch(() => {})

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
                    serverJobs: true,
                    clientJobs: false,
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
            
                const job = await scheduler.addJob({
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
            }, 30000);
        });
    
        describe('timezone validation', () => {
            it('should validate ambiguous times during DST transitions', async () => {
                const job = await scheduler.addJob({
                    name: 'ambiguous-time-test',
                    status: 'pending',
                    options: {
                        expression: '0 1 * * *',
                        timezone: 'America/New_York'
                    },
                    execute: async () => 'test'
                })
    
                vi.setSystemTime(new Date('2024-11-03T05:00:00.000Z'))
                
                const nextRun = scheduler.getNextRunTime(job)
                expect(nextRun).toBeDefined()
                expect(nextRun.getTime()).toBe(new Date('2024-11-03T06:00:00.000Z').getTime())
            })
        })
    })

    describe('timezone handling with non-UTC defaults', () => {
        describe('strict mode with custom default timezone', () => {
            beforeEach(async () => {
                await setupScheduler(createStrictOptions({
                    type: 'America/New_York',
                }))
            })
    
            it('should use custom default timezone for jobs without timezone', async () => {
                const job = await scheduler.addJob({
                    name: 'test job',
                    status: 'pending',
                    options: {
                        expression: '* * * * *',
                    },
                    execute: async () => 'test result',
                })
    
                expect(job.options.timezone).toBe('America/New_York')
            })
    
            it('should reject jobs with different timezone than default in strict mode', async () => {
                await expect(scheduler.addJob({
                    name: 'test job',
                    status: 'pending',
                    options: {
                        expression: '* * * * *',
                        timezone: 'Europe/London',
                    },
                    execute: async () => 'test result',
                })).rejects.toThrow('Cannot set per-job timezone when timezone.strict is enabled')
            })
    
            it('should accept jobs explicitly using the default timezone', async () => {
                const job = await scheduler.addJob({
                    name: 'test job',
                    status: 'pending',
                    options: {
                        expression: '* * * * *',
                        timezone: 'America/New_York',
                    },
                    execute: async () => 'test result',
                })
    
                expect(job.options.timezone).toBe('America/New_York')
            })
        })
    
        describe('flexible mode with custom default timezone', () => {
            beforeEach(async () => {
                await setupScheduler(createFlexibleOptions({
                    type: 'Asia/Tokyo',
                }))
            })
    
            it('should use custom default timezone when no timezone specified', async () => {
                const job = await scheduler.addJob({
                    name: 'test job',
                    status: 'pending',
                    options: {
                        expression: '* * * * *',
                    },
                    execute: async () => 'test result',
                })
    
                expect(job.options.timezone).toBe('Asia/Tokyo')
            })
    
            it('should allow overriding default timezone with job-specific timezone', async () => {
                const job = await scheduler.addJob({
                    name: 'test job',
                    status: 'pending',
                    options: {
                        expression: '* * * * *',
                        timezone: 'Europe/Paris',
                    },
                    execute: async () => 'test result',
                })
    
                expect(job.options.timezone).toBe('Europe/Paris')
            })
    
            it('should validate custom timezone even with different default timezone', async () => {
                await setupScheduler(createFlexibleOptions({
                    type: 'Asia/Tokyo',
                    validate: true,
                }))
    
                await expect(scheduler.addJob({
                    name: 'test job',
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
    
                const job = await scheduler.addJob({
                    name: 'test job',
                    status: 'pending',
                    options: {
                        expression: '0 2 * * *',
                    },
                    execute: async () => 'test result',
                })
    
                expect(job.metadata.nextRun).toBeDefined()
                expect(job.options.timezone).toBe('America/New_York')
            })
        })
    })
})