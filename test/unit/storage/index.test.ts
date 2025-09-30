import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

describe('MemoryStorage', () => {
        let MemoryStorage: any
  let storage: any
  let currentTime: number

  beforeEach(async () => {
                currentTime = new Date('2024-01-01T00:00:00.000Z').getTime()

    vi.useFakeTimers()
    vi.setSystemTime(currentTime)

    const module = await import('../../../src/runtime/storage')
    MemoryStorage = module.MemoryStorage
    storage = new MemoryStorage()
  })

  afterEach(() => {
                vi.useRealTimers()
  })

  describe('add', () => {
                it('should add a new task with generated id and timestamps', async () => {
                        const taskData = {
                                name: 'Test task',
                                expression: '* * * * *',
                                callback: 'console.log("test")',
                                enabled: true,
                        };

                        const task = await storage.add(taskData)

      // Verify the task structure and timestamps
      expect(task).toMatchObject({
                                ...taskData,
                                id: expect.any(String),
                                metadata: {
                                        runCount: 0,
                                        createdAt: new Date(currentTime),
                                        updatedAt: new Date(currentTime),
                                },
                        })
    })
  })

  describe('update', () => {
                it('should update an existing task with newer timestamp', async () => {
                        // Create initial task
                        const taskData = {
                                name: 'Test task',
                                expression: '* * * * *',
                                callback: 'console.log("test")',
                                enabled: true,
                        };
                        const task = await storage.add(taskData)
      const originalUpdatedAt = task.metadata.updatedAt

      // Advance time by 1 second before update
      vi.advanceTimersByTime(1000)

      const updates = {
                                name: 'Updated Task',
                                enabled: false,
                        };

                        const updatedTask = await storage.update(task.id, updates)

      // Verify the basic update worked
      expect({
                                ...updatedTask,
                                metadata: {
                                        ...updatedTask.metadata,
                                        updatedAt: task.metadata.updatedAt,
                                },
                        }).toMatchObject({
                                ...task,
                                ...updates,
                        })

      // Verify timestamps are correct
      expect(updatedTask.metadata.updatedAt.getTime()).toBeGreaterThan(
                                task.metadata.updatedAt.getTime(),
      );
                        expect(updatedTask.metadata.updatedAt.getTime()).toBeGreaterThan(
                                originalUpdatedAt.getTime(),
      );
                })
  })

  describe('get', () => {
                it('should retrieve an existing task', async () => {
                        const taskData = {
                                name: 'Test task',
                                expression: '* * * * *',
                                callback: 'console.log("test")',
                                enabled: true,
                        };

                        const addedTask = await storage.add(taskData)
      const retrievedTask = await storage.get(addedTask.id)

      expect(retrievedTask).toEqual(addedTask)
    })

    it('should return null for non-existent task', async () => {
                        const result = await storage.get('non-existent-id')
      expect(result).toBeNull()
    })
  })

  describe('getAll', () => {
                it('should return empty array when no tasks exist', async () => {
                        const Tasks = await storage.getAll()
      expect(Tasks).toEqual([])
    })

    it('should return all added tasks', async () => {
                        const taskData1 = {
                                name: 'Test task 1',
                                expression: '* * * * *',
                                callback: 'console.log("test1")',
                                enabled: true,
                        };

                        const task1 = await storage.add(taskData1)

      vi.advanceTimersByTime(1000)

      const taskData2 = {
                                name: 'Test Task 2',
                                expression: '*/5 * * * *',
                                callback: 'console.log("test2")',
                                enabled: false,
                        };

                        const task2 = await storage.add(taskData2)

      const allTasks = await storage.getAll()
      expect(allTasks).toHaveLength(2)
      expect(allTasks).toEqual(expect.arrayContaining([task1, task2]))

      expect(task2.metadata.createdAt.getTime()).toBeGreaterThan(
                                task1.metadata.createdAt.getTime(),
      );
                })
  })

  describe('concurrent operations', () => {
                it('should handle multiple simultaneous updates to the same task', async () => {
                        const Task = await storage.add({
                                name: 'Test task',
                                expression: '* * * * *',
                                callback: 'console.log("test")',
                                enabled: true,
                        })

      vi.advanceTimersByTime(1000)

      const updates = await Promise.all([
                                storage.update(Task.id, { name: 'Update 1' }),
                                storage.update(Task.id, { name: 'Update 2' }),
                                storage.update(Task.id, { name: 'Update 3' }),
                        ])

      const finalTask = await storage.get(Task.id)
      expect(updates.some(u => u.name === finalTask?.name)).toBe(true)

      updates.forEach((update) => {
                                expect(update.metadata.updatedAt.getTime()).toBeGreaterThan(
                                        Task.metadata.createdAt.getTime(),
        );
                        })
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

      expect(Task.metadata.createdAt).toEqual(new Date(currentTime))
    })

    it('should preserve existing valid dates when updating with invalid dates', async () => {
                        const validDate = new Date(currentTime)
      const Task = await storage.add({
                                name: 'Test task',
                                expression: '* * * * *',
                                callback: 'console.log("test")',
                                enabled: true,
                                metadata: {
                                        lastRun: validDate,
                                        nextRun: validDate,
                                },
                        })

      vi.advanceTimersByTime(1000)

      const updatedTask = await storage.update(Task.id, {
                                metadata: {
                                        lastRun: new Date('invalid date'),
                                },
                        })

      expect(updatedTask.metadata.lastRun).toBeUndefined()
      expect(updatedTask.metadata.nextRun).toEqual(validDate)
      expect(updatedTask.metadata.updatedAt.getTime()).toBeGreaterThan(
                                Task.metadata.createdAt.getTime(),
      );
                })
  })
})
