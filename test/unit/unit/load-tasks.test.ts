// test/unit/utils/load-tasks.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { loadTaskModule, loadTaskModules } from '../../../src/runtime/utils/loadTasks'
import { join } from 'pathe'

describe('loadTasks', () => {
    const mockTasksDir = '/test/tasks'

    beforeEach(() => {
        vi.clearAllMocks()
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    describe('loadTaskModule', () => {
        it('should load a valid task module', async () => {
            const task = {
                name: 'test-task',
                path: join(mockTasksDir, 'test-task.ts'),
            }

            // Mock the dynamic import
            vi.doMock(task.path, () => ({
                default: {
                    meta: {
                        name: 'test-task',
                        description: 'A test task',
                    },
                    schedule: '0 0 * * *',
                    handler: async () => ({ success: true }),
                },
            }))

            const result = await loadTaskModule(task, mockTasksDir)

            expect(result).toBeDefined()
            expect(result?.name).toBe('test-task')
            expect(result?.path).toBe('test-task')
            //@ts-expect-error
            expect(result?.module.default.meta.name).toBe('test-task')
        })

        it('should handle module without meta', async () => {
            const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => { })

            const task = {
                name: 'invalid-task',
                path: join(mockTasksDir, 'invalid-task.ts'),
            }

            // Mock a module without meta - must have default export
            vi.doMock(task.path, () => ({
                default: {
                    handler: async () => ({}),
                    // No meta property
                },
            }))

            const result = await loadTaskModule(task, mockTasksDir)

            expect(result).toBeNull()
            expect(consoleWarnSpy).toHaveBeenCalledWith(
                expect.stringContaining('invalid-task has invalid format')
            )

            consoleWarnSpy.mockRestore()
        })

        it('should handle module with no default export', async () => {
            const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => { })

            const task = {
                name: 'no-default-task',
                path: join(mockTasksDir, 'no-default-task.ts'),
            }

            // Mock a module with no default export - return empty default
            vi.doMock(task.path, () => ({
                default: undefined,
            }))

            const result = await loadTaskModule(task, mockTasksDir)

            expect(result).toBeNull()
            expect(consoleWarnSpy).toHaveBeenCalledWith(
                expect.stringContaining('no-default-task has invalid format')
            )

            consoleWarnSpy.mockRestore()
        })

        it('should handle module with null default export', async () => {
            const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => { })

            const task = {
                name: 'null-default-task',
                path: join(mockTasksDir, 'null-default-task.ts'),
            }

            vi.doMock(task.path, () => ({
                default: null,
            }))

            const result = await loadTaskModule(task, mockTasksDir)

            expect(result).toBeNull()
            expect(consoleWarnSpy).toHaveBeenCalledWith(
                expect.stringContaining('null-default-task has invalid format')
            )

            consoleWarnSpy.mockRestore()
        })

        it('should handle import errors', async () => {
            const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => { })

            const task = {
                name: 'error-task',
                path: join(mockTasksDir, 'non-existent.ts'),
            }

            // Don't mock - let it fail naturally
            const result = await loadTaskModule(task, mockTasksDir)

            expect(result).toBeNull()
            expect(consoleWarnSpy).toHaveBeenCalledWith(
                expect.stringContaining('Failed to load task error-task'),
                expect.any(Error)
            )

            consoleWarnSpy.mockRestore()
        })

        it('should correctly parse path relative to tasksDir', async () => {
            const task = {
                name: 'nested:task',
                path: join(mockTasksDir, 'nested', 'task.ts'),
            }

            vi.doMock(task.path, () => ({
                default: {
                    meta: {
                        name: 'nested:task',
                    },
                    schedule: '0 0 * * *',
                },
            }))

            const result = await loadTaskModule(task, mockTasksDir)

            expect(result).toBeDefined()
            expect(result?.path).toBe('nested/task')
        })
    })

    describe('loadTaskModules', () => {
        it('should load multiple valid tasks', async () => {
            const tasks = [
                { name: 'task1', path: join(mockTasksDir, 'task1.ts') },
                { name: 'task2', path: join(mockTasksDir, 'task2.ts') },
            ]

            tasks.forEach((task) => {
                vi.doMock(task.path, () => ({
                    default: {
                        meta: { name: task.name },
                        schedule: '0 0 * * *',
                    },
                }))
            })

            const results = await loadTaskModules(tasks, mockTasksDir)

            expect(results).toHaveLength(2)
            expect(results[0].name).toBe('task1')
            expect(results[1].name).toBe('task2')
        })

        it('should skip invalid tasks', async () => {
            const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => { })

            const tasks = [
                { name: 'valid-task', path: join(mockTasksDir, 'valid.ts') },
                { name: 'invalid-task', path: join(mockTasksDir, 'invalid.ts') },
            ]

            vi.doMock(tasks[0].path, () => ({
                default: {
                    meta: { name: 'valid-task' },
                    schedule: '0 0 * * *',
                },
            }))

            vi.doMock(tasks[1].path, () => ({
                default: {
                    // No meta
                    schedule: '0 0 * * *',
                },
            }))

            const results = await loadTaskModules(tasks, mockTasksDir)

            expect(results).toHaveLength(1)
            expect(results[0].name).toBe('valid-task')

            consoleWarnSpy.mockRestore()
        })

        it('should return empty array when all tasks fail to load', async () => {
            const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => { })

            const tasks = [
                { name: 'task1', path: join(mockTasksDir, 'non-existent1.ts') },
                { name: 'task2', path: join(mockTasksDir, 'non-existent2.ts') },
            ]

            const results = await loadTaskModules(tasks, mockTasksDir)

            expect(results).toHaveLength(0)
            expect(consoleWarnSpy).toHaveBeenCalledTimes(2)

            consoleWarnSpy.mockRestore()
        })

        it('should handle empty task list', async () => {
            const results = await loadTaskModules([], mockTasksDir)

            expect(results).toHaveLength(0)
        })

        it('should handle mix of valid and invalid tasks', async () => {
            const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => { })

            const tasks = [
                { name: 'task1', path: join(mockTasksDir, 'task1.ts') },
                { name: 'task2', path: join(mockTasksDir, 'task2.ts') },
                { name: 'task3', path: join(mockTasksDir, 'task3.ts') },
            ]

            vi.doMock(tasks[0].path, () => ({
                default: {
                    meta: { name: 'task1' },
                    schedule: '0 0 * * *',
                },
            }))

            vi.doMock(tasks[1].path, () => ({
                default: null, // Invalid
            }))

            vi.doMock(tasks[2].path, () => ({
                default: {
                    meta: { name: 'task3' },
                    schedule: '0 0 * * *',
                },
            }))

            const results = await loadTaskModules(tasks, mockTasksDir)

            expect(results).toHaveLength(2)
            expect(results[0].name).toBe('task1')
            expect(results[1].name).toBe('task3')

            consoleWarnSpy.mockRestore()
        })
    })
})