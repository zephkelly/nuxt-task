import { describe, it, expect, beforeEach } from 'vitest'



describe('MemoryStorage', () => {
    let MemoryStorage: any
    let storage: any

    beforeEach(async () => {
        const module = await import('../../../src/runtime/utils/storage')
        MemoryStorage = module.MemoryStorage
        storage = new MemoryStorage()
    })

    describe('add', () => {
        it('should add a new Task with generated id and timestamps', async () => {
            const TaskData = {
                name: 'Test Task',
                expression: '* * * * *',
                callback: 'console.log("test")',
                enabled: true,
            }

            const Task = await storage.add(TaskData)

            expect(Task).toMatchObject({
                ...TaskData,
                id: expect.any(String),
                metadata: {
                    runCount: 0,
                    createdAt: expect.any(Date),
                    updatedAt: expect.any(Date),
                },
            })
        })
    })

    describe('update', () => {
        it('should update an existing Task', async () => {
            const TaskData = {
                name: 'Test Task',
                expression: '* * * * *',
                callback: 'console.log("test")',
                enabled: true,
            }

            const Task = await storage.add(TaskData)
            const originalUpdatedAt = Task.metadata.updatedAt

            await new Promise(resolve => setTimeout(resolve, 1))

            const updates = {
                name: 'Updated Task',
                enabled: false,
            }

            const updatedTask = await storage.update(Task.id, updates)

            expect({
                ...updatedTask,
                metadata: {
                    ...updatedTask.metadata,
                    updatedAt: Task.metadata.updatedAt,
                },
            }).toMatchObject({
                ...Task,
                ...updates,
            })

            expect(updatedTask.metadata.updatedAt.getTime()).toBeGreaterThan(Task.metadata.updatedAt.getTime())
            expect(updatedTask.metadata.updatedAt.getTime()).toBeGreaterThan(originalUpdatedAt.getTime())
        })
    })

    describe('get', () => {
        it('should retrieve an existing Task', async () => {
            const TaskData = {
                name: 'Test Task',
                expression: '* * * * *',
                callback: 'console.log("test")',
                enabled: true,
            }

            const addedTask = await storage.add(TaskData)
            const retrievedTask = await storage.get(addedTask.id)

            expect(retrievedTask).toEqual(addedTask)
        })

        it('should return null for non-existent Task', async () => {
            const result = await storage.get('non-existent-id')
            expect(result).toBeNull()
        })
    })

    describe('getAll', () => {
        it('should return empty array when no Tasks exist', async () => {
            const Tasks = await storage.getAll()
            expect(Tasks).toEqual([])
        })

        it('should return all added Tasks', async () => {
            const TaskData1 = {
                name: 'Test Task 1',
                expression: '* * * * *',
                callback: 'console.log("test1")',
                enabled: true,
            }

            const TaskData2 = {
                name: 'Test Task 2',
                expression: '*/5 * * * *',
                callback: 'console.log("test2")',
                enabled: false,
            }

            const Task1 = await storage.add(TaskData1)
            const Task2 = await storage.add(TaskData2)

            const allTasks = await storage.getAll()
            expect(allTasks).toHaveLength(2)
            expect(allTasks).toEqual(expect.arrayContaining([Task1, Task2]))
        })
    })

    describe('concurrent operations', () => {
        it('should handle multiple simultaneous updates to the same Task', async () => {
            const Task = await storage.add({
                name: 'Test Task',
                expression: '* * * * *',
                callback: 'console.log("test")',
                enabled: true,
            })

            // Simulate concurrent updates
            const updates = await Promise.all([
                storage.update(Task.id, { name: 'Update 1' }),
                storage.update(Task.id, { name: 'Update 2' }),
                storage.update(Task.id, { name: 'Update 3' }),
            ])

            const finalTask = await storage.get(Task.id)
            expect(updates.some(u => u.name === finalTask?.name)).toBe(true)
        })
    })

    describe('edge cases', () => {
        it('should handle empty strings in Task properties', async () => {
            const Task = await storage.add({
                name: '',
                expression: '* * * * *',
                callback: '',
                enabled: true,
            })

            expect(Task.name).toBe('')
            expect(Task.callback).toBe('')
        })

        it('should handle extremely long Task names and callbacks', async () => {
            const longString = 'a'.repeat(10000)
            const Task = await storage.add({
                name: longString,
                expression: '* * * * *',
                callback: longString,
                enabled: true,
            })

            expect(Task.name).toBe(longString)
            expect(Task.callback).toBe(longString)
        })

        it('should handle special characters in Task properties', async () => {
            const Task = await storage.add({
                name: '!@#$%^&*()',
                expression: '* * * * *',
                callback: 'console.log("⚡️🎉")',
                enabled: true,
            })

            const retrieved = await storage.get(Task.id)
            expect(retrieved).toEqual(Task)
        })
    })

    describe('date handling', () => {
        it('should handle invalid dates in lastRun and nextRun', async () => {
            const Task = await storage.add({
                name: 'Test Task',
                expression: '* * * * *',
                callback: 'console.log("test")',
                enabled: true,
                metadata: {
                    lastRun: new Date('invalid date'),
                    nextRun: new Date('invalid date'),
                },
            })

            expect(Task.metadata.lastRun).toBeUndefined()
            expect(Task.metadata.nextRun).toBeUndefined()
        })

        it('should handle undefined dates', async () => {
            const Task = await storage.add({
                name: 'Test Task',
                expression: '* * * * *',
                callback: 'console.log("test")',
                enabled: true,
                metadata: {
                    lastRun: undefined,
                    nextRun: undefined,
                },
            })

            expect(Task.metadata.lastRun).toBeUndefined()
            expect(Task.metadata.nextRun).toBeUndefined()
        })

        it('should handle date updates from valid to invalid', async () => {
            const validDate = new Date()
            const Task = await storage.add({
                name: 'Test Task',
                expression: '* * * * *',
                callback: 'console.log("test")',
                enabled: true,
                metadata: {
                    lastRun: validDate,
                    nextRun: validDate,
                },
            })

            const updatedTask = await storage.update(Task.id, {
                metadata: {
                    lastRun: new Date('invalid date'),
                    nextRun: new Date('invalid date'),
                },
            })

            expect(updatedTask.metadata.lastRun).toBeUndefined()
            expect(updatedTask.metadata.nextRun).toBeUndefined()
        })

        it('should preserve existing valid dates when updating with invalid dates', async () => {
            const validDate = new Date()
            const Task = await storage.add({
                name: 'Test Task',
                expression: '* * * * *',
                callback: 'console.log("test")',
                enabled: true,
                metadata: {
                    lastRun: validDate,
                    nextRun: validDate,
                },
            })

            const updatedTask = await storage.update(Task.id, {
                metadata: {
                    lastRun: new Date('invalid date'),
                },
            })

            expect(updatedTask.metadata.lastRun).toBeUndefined()
            expect(updatedTask.metadata.nextRun).toEqual(validDate)
        })
    })

    describe('bulk operations', () => {
        it('should handle adding many Tasks simultaneously', async () => {
            const Tasks = Array.from({ length: 1000 }, (_, i) => ({
                name: `Task ${i}`,
                expression: '* * * * *',
                callback: `console.log(${i})`,
                enabled: true,
            }))

            const added = await Promise.all(Tasks.map(Task => storage.add(Task)))
            expect(added).toHaveLength(Tasks.length)

            const all = await storage.getAll()
            expect(all).toHaveLength(Tasks.length)
        })

        it('should handle removing many Tasks simultaneously', async () => {
            const Tasks = await Promise.all(
                Array.from({ length: 100 }, (_, i) => storage.add({
                    name: `Task ${i}`,
                    expression: '* * * * *',
                    callback: `console.log(${i})`,
                    enabled: true,
                })),
            )

            // Remove them all simultaneously
            await Promise.all(Tasks.map(Task => storage.remove(Task.id)))

            const remaining = await storage.getAll()
            expect(remaining).toHaveLength(0)
        })
    })

    describe('remove', () => {
        it('should remove an existing Task', async () => {
            const Task = await storage.add({
                name: 'Test Task',
                expression: '* * * * *',
                callback: 'console.log("test")',
                enabled: true,
            })

            const result = await storage.remove(Task.id)
            expect(result).toBe(true)

            const retrievedTask = await storage.get(Task.id)
            expect(retrievedTask).toBeNull()
        })

        it('should return false when removing non-existent Task', async () => {
            const result = await storage.remove('non-existent-id')
            expect(result).toBe(false)
        })
    })

    describe('clear', () => {
        it('should remove all Tasks', async () => {
            await storage.add({
                name: 'Test Task 1',
                expression: '* * * * *',
                callback: 'console.log("test1")',
                enabled: true,
            })

            await storage.add({
                name: 'Test Task 2',
                expression: '*/5 * * * *',
                callback: 'console.log("test2")',
                enabled: false,
            })

            await storage.clear()
            const Tasks = await storage.getAll()
            expect(Tasks).toHaveLength(0)
        })
    })
})