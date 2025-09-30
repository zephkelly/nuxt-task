import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { MemoryStorage } from './../../../src/runtime/storage/environments/memory'
import type {
        CronTask,
        CronTaskStatus,
} from './../../../src/runtime/task/types'

describe('MemoryStorage', () => {
        let storage: MemoryStorage
  let currentTime: number

  beforeEach(() => {
                currentTime = new Date('2024-01-01T00:00:00.000Z').getTime()
    vi.useFakeTimers()
    vi.setSystemTime(currentTime)
    storage = new MemoryStorage()
  })

  afterEach(() => {
                vi.useRealTimers()
  })

  describe('constructor', () => {
                it('should initialize with default prefix', () => {
                        const store = new MemoryStorage()
      expect(store['prefix']).toBe('cron:')
    })

    it('should initialize with custom prefix', () => {
                        const store = new MemoryStorage({ prefix: 'test:' })
      expect(store['prefix']).toBe('test:')
    })
  })

  describe('add', () => {
                it('should add a task without id and metadata', async () => {
                        const taskData = {
                                name: 'Test Task',
                                status: 'pending' as const,
                                options: {
                                        expression: '* * * * *',
                                        timeout: 1000,
                                },
                                execute: async () => 'test',
                        };

                        const task = await storage.add(taskData)
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

    it('should add a complete task with existing id and metadata', async () => {
                        const existingTask: CronTask = {
                                id: 'test-id',
                                name: 'Test Task',
                                status: 'pending',
                                options: {
                                        expression: '* * * * *',
                                        timeout: 1000,
                                        timezone: 'UTC',
                                },
                                execute: async () => 'test',
                                metadata: {
                                        runCount: 5,
                                        createdAt: new Date(currentTime - 1000),
                                        updatedAt: new Date(currentTime - 1000),
                                },
                        };

                        const task = await storage.add(existingTask)
      expect(task).toEqual(existingTask)
    })

    it('should throw error when adding task with existing id', async () => {
                        const taskData = {
                                id: 'duplicate-id',
                                name: 'Test Task',
                                status: 'pending' satisfies CronTaskStatus as CronTaskStatus,
                                options: {
                                        expression: '* * * * *',
                                        timeout: 1000,
                                },
                                execute: async () => 'test',
                                metadata: {
                                        runCount: 0,
                                        createdAt: new Date(),
                                        updatedAt: new Date(),
                                },
                        };

                        await storage.add(taskData)
      await expect(storage.add(taskData)).rejects.toThrow(
                                "Task with id duplicate-id already exists"
                        );
                })
  })

  describe('update', () => {
                it('should update task with partial data', async () => {
                        const task = await storage.add({
                                name: 'Original Task',
                                status: 'pending',
                                options: {
                                        expression: '* * * * *',
                                        timeout: 1000,
                                },
                                execute: async () => 'test',
                        })

      vi.advanceTimersByTime(1000)

      const updatedTask = await storage.update(task.id, {
                                name: 'Updated Task',
                                status: 'running',
                                options: {
                                        timeout: 2000,
                                        expression: '* * * * *',
                                },
                        })

      expect(updatedTask).toMatchObject({
                                id: task.id,
                                name: 'Updated Task',
                                status: 'running',
                                options: {
                                        expression: '* * * * *',
                                        timeout: 2000,
                                },
                        })
      expect(updatedTask.metadata.updatedAt.getTime()).toBeGreaterThan(
                                task.metadata.updatedAt.getTime(),
      );
                })

    it('should handle metadata updates correctly', async () => {
                        const task = await storage.add({
                                name: 'Test Task',
                                status: 'pending',
                                options: { expression: '* * * * *' },
                                execute: async () => 'test',
                        })

      vi.advanceTimersByTime(1000)

      const lastRun = new Date()
      const updatedTask = await storage.update(task.id, {
                                metadata: {
                                        lastRun,
                                        runCount: 1,
                                        createdAt: new Date(currentTime - 1000),
                                        updatedAt: new Date(currentTime - 1000),
                                },
                        })

      expect(updatedTask.metadata).toMatchObject({
                                lastRun,
                                runCount: 1,
                        })
    })

    it('should throw error when updating non-existent task', async () => {
                        await expect(
                                storage.update('non-existent', { name: 'New Name' }),
      ).rejects.toThrow('Task with id non-existent not found')
    })
  })

  describe('getAll', () => {
                it('should return all tasks in correct order', async () => {
                        const task1 = await storage.add({
                                name: 'Task 1',
                                status: 'pending',
                                options: { expression: '* * * * *' },
                                execute: async () => 'test1',
                        })

      vi.advanceTimersByTime(1000)

      const task2 = await storage.add({
                                name: 'Task 2',
                                status: 'pending',
                                options: { expression: '*/5 * * * *' },
                                execute: async () => 'test2',
                        })

      const allTasks = await storage.getAll()
      expect(allTasks).toHaveLength(2)
      expect(allTasks).toEqual(expect.arrayContaining([task1, task2]))
    })
  })

  describe('remove', () => {
                it('should remove existing task', async () => {
                        const task = await storage.add({
                                name: 'Test Task',
                                status: 'pending',
                                options: { expression: '* * * * *' },
                                execute: async () => 'test',
                        })

      const result = await storage.remove(task.id)
      expect(result).toBe(true)

      const retrievedTask = await storage.get(task.id)
      expect(retrievedTask).toBeNull()
    })

    it('should return false when removing non-existent task', async () => {
                        const result = await storage.remove('non-existent')
      expect(result).toBe(false)
    })
  })

  describe('clear', () => {
                it('should remove all tasks', async () => {
                        await storage.add({
                                name: 'Task 1',
                                status: 'pending',
                                options: { expression: '* * * * *' },
                                execute: async () => 'test1',
                        })

      await storage.add({
                                name: 'Task 2',
                                status: 'pending',
                                options: { expression: '*/5 * * * *' },
                                execute: async () => 'test2',
                        })

      await storage.clear()
      const tasks = await storage.getAll()
      expect(tasks).toHaveLength(0)
    })
  })

  describe('task status transitions', () => {
                it('should handle task status changes', async () => {
                        const task = await storage.add({
                                name: 'Status Test Task',
                                status: 'pending',
                                options: { expression: '* * * * *' },
                                execute: async () => 'test',
                        })

      // Update to running
      const runningTask = await storage.update(task.id, {
                                status: 'running',
                        })
      expect(runningTask.status).toBe('running')

      // Update to completed
      const completedTask = await storage.update(task.id, {
                                status: 'completed',
                        })
      expect(completedTask.status).toBe('completed')

      // Update back to pending
      const pendingTask = await storage.update(task.id, {
                                status: 'pending',
                        })
      expect(pendingTask.status).toBe('pending')
    })
  })
})
