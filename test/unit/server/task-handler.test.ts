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
})