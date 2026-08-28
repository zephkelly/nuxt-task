import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { defineTaskHandler, type NuxtCronTaskDefinition } from '~/src/runtime'
import { moduleConfiguration } from '~/src/runtime/config'
import type { ModuleOptions } from '~/src/runtime/scheduler'


vi.mock('#imports', () => ({
    useRuntimeConfig: vi.fn(),
}))

describe('defineTaskHandler', () => {
    const mockModuleOptions: ModuleOptions = {
        serverTasks: true,
        clientTasks: false,
        experimental: {
            tasks: false,
        },
        storage: {
            type: 'memory' as const,
        },
        timezone: {
            type: 'UTC',
            validate: true,
            strict: false,
        },
    }

    let getModuleOptionsSpy: any

    beforeEach(() => {
        vi.clearAllMocks()

        // Spy on the singleton instance methods
        getModuleOptionsSpy = vi.spyOn(moduleConfiguration, 'getModuleOptions')
            .mockReturnValue(mockModuleOptions)
    })

    afterEach(() => {
        // Restore all spies after each test
        vi.restoreAllMocks()
    })

    describe('basic task definition', () => {
        it('should create a task handler with minimal definition', () => {
            const taskDef: NuxtCronTaskDefinition = {
                meta: {
                    name: 'test-task',
                },
                schedule: '0 0 * * *',
                handler: async () => ({ success: true }),
            }

            const handler = defineTaskHandler(taskDef)

            expect(handler.meta.name).toBe('test-task')
            expect(handler.schedule).toBe('0 0 * * *')
            expect(handler.options).toEqual({})
        })

        it('should include description when provided', () => {
            const taskDef: NuxtCronTaskDefinition = {
                meta: {
                    name: 'test-task',
                    description: 'A test task',
                },
                schedule: '0 0 * * *',
                handler: async () => ({ success: true }),
            }

            const handler = defineTaskHandler(taskDef)

            expect(handler.meta.description).toBe('A test task')
        })

        it('should include options when provided', () => {
            const taskDef: NuxtCronTaskDefinition = {
                meta: {
                    name: 'test-task',
                },
                schedule: '0 0 * * *',
                handler: async () => ({ success: true }),
                options: {
                    timezone: 'America/New_York',
                    maxRetries: 3,
                },
            }

            const handler = defineTaskHandler(taskDef)

            expect(handler.options).toEqual({
                timezone: 'America/New_York',
                maxRetries: 3,
            })
        })
    })

    describe('non-experimental mode', () => {
        beforeEach(() => {
            getModuleOptionsSpy.mockReturnValue({
                ...mockModuleOptions,
                experimental: { tasks: false },
            })
        })

        it('should execute handler successfully', async () => {
            const mockHandler = vi.fn().mockResolvedValue({ data: 'test' })
            const taskDef: NuxtCronTaskDefinition = {
                meta: { name: 'test-task' },
                schedule: '0 0 * * *',
                handler: mockHandler,
            }

            const handler = defineTaskHandler(taskDef)
            const context = { payload: { test: 'data' } }
            const result = await handler.run(context)

            expect(mockHandler).toHaveBeenCalledWith(context)
            expect(result).toEqual({ data: 'test', success: true })
        })

        it('should throw error for invalid cron expression', async () => {
            const taskDef: NuxtCronTaskDefinition = {
                meta: { name: 'test-task' },
                schedule: 'invalid cron',
                handler: async () => ({ success: true }),
            }

            const handler = defineTaskHandler(taskDef)

            await expect(handler.run({ payload: {} })).rejects.toThrow()
        })

        it('should propagate handler errors', async () => {
            const mockError = new Error('Handler failed')
            const taskDef: NuxtCronTaskDefinition = {
                meta: { name: 'test-task' },
                schedule: '0 0 * * *',
                handler: async () => {
                    throw mockError
                },
            }

            const handler = defineTaskHandler(taskDef)

            await expect(handler.run({ payload: {} })).rejects.toThrow('Handler failed')
        })

        it('should wrap non-Error exceptions', async () => {
            const taskDef: NuxtCronTaskDefinition = {
                meta: { name: 'test-task' },
                schedule: '0 0 * * *',
                handler: async () => {
                    throw 'string error'
                },
            }

            const handler = defineTaskHandler(taskDef)

            await expect(handler.run({ payload: {} })).rejects.toThrow('Unknown error in task execution')
        })

        it('should include _custom metadata', () => {
            const taskDef: NuxtCronTaskDefinition = {
                meta: { name: 'test-task' },
                schedule: '0 0 * * *',
                handler: async () => ({ success: true }),
            }

            const handler = defineTaskHandler(taskDef)

            // _custom only exists in non-experimental mode
            expect(handler).toHaveProperty('_custom')
            expect((handler as any)._custom).toEqual({
                type: 'nuxt-task',
                version: '1.0',
                virtual: true,
            })
        })
    })

    describe('timezone handling', () => {
        it('should validate cron expression with timezone', async () => {
            getModuleOptionsSpy.mockReturnValue({
                ...mockModuleOptions,
                timezone: {
                    type: 'Asia/Tokyo',
                    validate: true,
                    strict: false,
                },
                experimental: { tasks: true },
            })

            const taskDef: NuxtCronTaskDefinition = {
                meta: { name: 'test-task' },
                schedule: '0 0 * * *',
                handler: async () => ({ success: true }),
            }

            const handler = defineTaskHandler(taskDef)
            const result = await handler.run({ name: 'test-task' })

            // Should successfully validate and execute
            expect(result.success).toBe(true)
        })

        it('should use strict timezone when configured', async () => {
            getModuleOptionsSpy.mockReturnValue({
                ...mockModuleOptions,
                timezone: {
                    type: 'America/Los_Angeles',
                    validate: true,
                    strict: true,
                },
                experimental: { tasks: false }, // Note: non-experimental mode
            })

            const mockHandler = vi.fn().mockResolvedValue({ success: true })
            const taskDef: NuxtCronTaskDefinition = {
                meta: { name: 'test-task' },
                schedule: '0 0 * * *',
                handler: mockHandler,
            }

            const handler = defineTaskHandler(taskDef)
            await handler.run({ name: 'test-task' })

            // In non-experimental mode, the whole context is passed
            expect(mockHandler).toHaveBeenCalledWith({
                name: 'test-task',
            })
        })
    })

    describe('config resolution', () => {
        it('should use useRuntimeConfig when available', async () => {
            const { useRuntimeConfig } = await import('#imports')
            vi.mocked(useRuntimeConfig).mockReturnValue({
                nuxtTask: {
                    ...mockModuleOptions,
                    timezone: {
                        type: 'America/New_York',
                        validate: true,
                        strict: false,
                    },
                    experimental: { tasks: false },
                },
            } as any)

            const taskDef: NuxtCronTaskDefinition = {
                meta: { name: 'test-task' },
                schedule: '0 0 * * *',
                handler: async (ctx) => ctx,
            }

            const handler = defineTaskHandler(taskDef)
            const result = await handler.run({ test: 'data' })

            expect(result).toHaveProperty('test', 'data')
        })
    })

    describe('experimental (native) mode', () => {
        // The native branch is selected by config.experimental.tasks. Config is
        // resolved from a bare global useRuntimeConfig() first and only falls
        // back to the singleton, and which of those wins differs between the
        // node and nuxt vitest projects. Point both at the same native options
        // so the branch is native in either project.
        const nativeOptions: ModuleOptions = {
            ...mockModuleOptions,
            experimental: { tasks: true },
        }

        beforeEach(async () => {
            const { useRuntimeConfig } = await import('#imports')
            vi.mocked(useRuntimeConfig).mockReturnValue({ nuxtTask: nativeOptions } as any)
            vi.stubGlobal('useRuntimeConfig', () => ({ nuxtTask: nativeOptions }))
            getModuleOptionsSpy.mockReturnValue(nativeOptions)
        })

        afterEach(() => {
            vi.unstubAllGlobals()
        })

        it('should select the native branch (no _custom marker)', () => {
            const handler = defineTaskHandler({
                meta: { name: 'test-task' },
                schedule: '0 0 * * *',
                handler: async () => ({ success: true }),
            })

            expect(handler).not.toHaveProperty('_custom')
        })

        describe('schedules croner accepts but the module parser rejects', () => {
            // Nitro schedules native tasks with croner, so croner has already
            // validated the expression before run() is reached. Re-validating
            // with the stricter in-module parser makes these tasks dead.
            const cronerValidSchedules = [
                ['day-of-week 7 (Sunday)', '0 0 * * 7'],
                ['day-of-week alias', '0 0 * * SUN'],
                ['nickname', '@daily'],
                ['six-field with seconds', '0 0 0 * * *'],
            ] as const

            it.each(cronerValidSchedules)('should run the handler for %s', async (_label, schedule) => {
                const mockHandler = vi.fn().mockResolvedValue({ data: 'ran' })

                const handler = defineTaskHandler({
                    meta: { name: 'test-task' },
                    schedule,
                    handler: mockHandler,
                })

                const result = await handler.run({ name: 'test-task' })

                expect(mockHandler).toHaveBeenCalledTimes(1)
                expect(result).toEqual({ data: 'ran', success: true })
            })
        })

        describe('error propagation', () => {
            it('should reject when the handler throws an Error', async () => {
                const handler = defineTaskHandler({
                    meta: { name: 'test-task' },
                    schedule: '0 0 * * *',
                    handler: async () => {
                        throw new Error('Handler failed')
                    },
                })

                await expect(handler.run({ name: 'test-task' })).rejects.toThrow('Handler failed')
            })

            it('should wrap and reject non-Error exceptions', async () => {
                const handler = defineTaskHandler({
                    meta: { name: 'test-task' },
                    schedule: '0 0 * * *',
                    handler: async () => {
                        throw 'string error'
                    },
                })

                await expect(handler.run({ name: 'test-task' }))
                    .rejects.toThrow('Unknown error in task execution')
            })

            it('should not resolve a failure as { success: false }', async () => {
                const handler = defineTaskHandler({
                    meta: { name: 'test-task' },
                    schedule: '0 0 * * *',
                    handler: async () => {
                        throw new Error('Handler failed')
                    },
                })

                const settled = await handler.run({ name: 'test-task' })
                    .then(() => 'resolved', () => 'rejected')

                expect(settled).toBe('rejected')
            })
        })

        describe('handler context', () => {
            it('should resolve successfully with the task result spread in', async () => {
                const handler = defineTaskHandler({
                    meta: { name: 'test-task' },
                    schedule: '0 0 * * *',
                    handler: async () => ({ data: 'test' }),
                })

                await expect(handler.run({ name: 'test-task' }))
                    .resolves.toEqual({ data: 'test', success: true })
            })

            it('should not let a payload key shadow the task name', async () => {
                const mockHandler = vi.fn().mockResolvedValue({})

                const handler = defineTaskHandler({
                    meta: { name: 'test-task' },
                    schedule: '0 0 * * *',
                    handler: mockHandler,
                })

                await handler.run({
                    name: 'real-task',
                    payload: { name: 'spoofed' },
                })

                expect(mockHandler).toHaveBeenCalledWith(
                    expect.objectContaining({ name: 'real-task' })
                )
            })

            it('should not let a payload key shadow the timezone', async () => {
                const mockHandler = vi.fn().mockResolvedValue({})

                const handler = defineTaskHandler({
                    meta: { name: 'test-task' },
                    schedule: '0 0 * * *',
                    handler: mockHandler,
                })

                await handler.run({
                    name: 'real-task',
                    payload: { timezone: 'Antarctica/Troll' },
                })

                expect(mockHandler).toHaveBeenCalledWith(
                    expect.objectContaining({ timezone: 'UTC' })
                )
            })

            it('should pass payload and context through to the handler', async () => {
                const mockHandler = vi.fn().mockResolvedValue({})

                const handler = defineTaskHandler({
                    meta: { name: 'test-task' },
                    schedule: '0 0 * * *',
                    handler: mockHandler,
                })

                await handler.run({
                    name: 'real-task',
                    payload: { fromPayload: 1 },
                    context: { fromContext: 2 },
                })

                expect(mockHandler).toHaveBeenCalledWith(
                    expect.objectContaining({ fromPayload: 1, fromContext: 2 })
                )
            })
        })

        describe('task options', () => {
            // These were accepted, validated, and then dropped on the floor:
            // the build only forwards name/description/handler to Nitro, and
            // run() never looked at definition.options at all.
            it('prefers a per-task timezone over the module timezone', async () => {
                const mockHandler = vi.fn().mockResolvedValue({})

                const handler = defineTaskHandler({
                    meta: { name: 'test-task' },
                    schedule: '0 0 * * *',
                    options: { timezone: 'Asia/Tokyo' },
                    handler: mockHandler,
                })

                await handler.run({ name: 'test-task' })

                expect(mockHandler).toHaveBeenCalledWith(
                    expect.objectContaining({ timezone: 'Asia/Tokyo' })
                )
            })

            it('falls back to the module timezone when the task sets none', async () => {
                const mockHandler = vi.fn().mockResolvedValue({})

                const handler = defineTaskHandler({
                    meta: { name: 'test-task' },
                    schedule: '0 0 * * *',
                    handler: mockHandler,
                })

                await handler.run({ name: 'test-task' })

                expect(mockHandler).toHaveBeenCalledWith(
                    expect.objectContaining({ timezone: 'UTC' })
                )
            })

            it('rejects when the handler exceeds its timeout', async () => {
                const handler = defineTaskHandler({
                    meta: { name: 'test-task' },
                    schedule: '0 0 * * *',
                    options: { timeout: 10 },
                    handler: () => new Promise(() => {}),
                })

                await expect(handler.run({ name: 'test-task' }))
                    .rejects.toThrow('task timeout')
            })

            it('does not time out a handler that finishes in time', async () => {
                const handler = defineTaskHandler({
                    meta: { name: 'test-task' },
                    schedule: '0 0 * * *',
                    options: { timeout: 5000 },
                    handler: async () => ({ data: 'quick' }),
                })

                await expect(handler.run({ name: 'test-task' }))
                    .resolves.toEqual({ data: 'quick', success: true })
            })

            it('retries a failing handler up to maxRetries', async () => {
                const mockHandler = vi.fn().mockRejectedValue(new Error('boom'))

                const handler = defineTaskHandler({
                    meta: { name: 'test-task' },
                    schedule: '0 0 * * *',
                    options: { maxRetries: 2, retryDelay: 1 },
                    handler: mockHandler,
                })

                await expect(handler.run({ name: 'test-task' })).rejects.toThrow('boom')

                // Initial attempt plus two retries.
                expect(mockHandler).toHaveBeenCalledTimes(3)
            })

            it('stops retrying once an attempt succeeds', async () => {
                const mockHandler = vi
                    .fn()
                    .mockRejectedValueOnce(new Error('boom'))
                    .mockResolvedValue({ data: 'recovered' })

                const handler = defineTaskHandler({
                    meta: { name: 'test-task' },
                    schedule: '0 0 * * *',
                    options: { maxRetries: 5, retryDelay: 1 },
                    handler: mockHandler,
                })

                await expect(handler.run({ name: 'test-task' }))
                    .resolves.toEqual({ data: 'recovered', success: true })
                expect(mockHandler).toHaveBeenCalledTimes(2)
            })

            it('does not retry when maxRetries is 0', async () => {
                const mockHandler = vi.fn().mockRejectedValue(new Error('boom'))

                const handler = defineTaskHandler({
                    meta: { name: 'test-task' },
                    schedule: '0 0 * * *',
                    options: { maxRetries: 0, retryDelay: 1 },
                    handler: mockHandler,
                })

                await expect(handler.run({ name: 'test-task' })).rejects.toThrow('boom')

                // maxRetries: 0 means run once, not never run.
                expect(mockHandler).toHaveBeenCalledTimes(1)
            })

            it('runs exactly once when no retry options are set', async () => {
                const mockHandler = vi.fn().mockRejectedValue(new Error('boom'))

                const handler = defineTaskHandler({
                    meta: { name: 'test-task' },
                    schedule: '0 0 * * *',
                    handler: mockHandler,
                })

                await expect(handler.run({ name: 'test-task' })).rejects.toThrow('boom')

                expect(mockHandler).toHaveBeenCalledTimes(1)
            })
        })
    })
})