import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TaskQueue } from '../../../src/runtime/scheduler/queue'
import type { CronTask, CronTaskStatus } from '../../../src/runtime/task/types'

describe('TaskQueue', () => {
  let queue: TaskQueue
        let localTask: CronTask

        const mockTaskTemplate: CronTask = {
    id: 'test-task',
    name: 'Test Task',
    status: 'pending',
    execute: vi.fn().mockResolvedValue('success'),
    options: {
      expression: '* * * * *',
      maxRetries: 3,
      retryDelay: 1000,
      timeout: 5000,
    },
    metadata: {
      runCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  };

  beforeEach(() => {
    queue = new TaskQueue()
                localTask = JSON.parse(JSON.stringify(mockTaskTemplate))
                localTask.execute = vi.fn().mockResolvedValue('success')
                vi.clearAllMocks()
        })

        // Previous test blocks remain the same...

        describe('Task Execution', () => {
    it('should handle task execution failure and retry', async () => {
      // Create a task that fails once then succeeds
      localTask.execute = vi
        .fn()
        .mockRejectedValueOnce(new Error('test error'))
        .mockResolvedValueOnce('success')

                        queue.add(localTask)
                        const retryEmitSpy = vi.spyOn(queue, 'emit')

                        await queue.executeTask(localTask.id)

                        expect(retryEmitSpy).toHaveBeenCalledWith(
        "retry",
        expect.any(Object),
                        );
      expect(localTask.metadata.runCount).toBe(1)
                })

                it('should respect max retries', async () => {
      // Set up a task that has reached its retry limit
      localTask.metadata.runCount = 4
                        localTask.execute = vi
        .fn()
        .mockRejectedValue(new Error('test error'))

                        queue.add(localTask)
                        await queue.executeTask(localTask.id)

                        expect(localTask.execute).not.toHaveBeenCalled()
                })
        })

        describe('Task Status Management', () => {
    it('should handle pause/resume correctly', () => {
      queue.add(localTask)

                        queue.pause(localTask.id)
                        expect(localTask.status).toBe('paused')

                        queue.resume(localTask.id)
                        expect(localTask.status).toBe('pending')
                })

                it('should track running tasks correctly', async () => {
      queue.add(localTask)

                        // Check initial state
                        expect(queue.isRunning(localTask.id)).toBe(false)

                        // Check during execution
                        const executePromise = queue.executeTask(localTask.id)
                        expect(queue.isRunning(localTask.id)).toBe(true)

                        // Check after completion
                        await executePromise
                        expect(queue.isRunning(localTask.id)).toBe(false)
                })
        })

        describe('Event Emission', () => {
    it('should emit correct events during task lifecycle', async () => {
      queue.add(localTask)
                        const eventSpy = vi.spyOn(queue, 'emit')

                        try {
        await queue.executeTask(localTask.id)
                                await Promise.resolve() // Ensure all promises are settled
                        }
      catch (error) {
        console.error('Test error:', error)
                        }

      expect(eventSpy).toHaveBeenCalledWith(
        "started",
        expect.any(Object),
                        );
      expect(eventSpy).toHaveBeenCalledWith(
        "completed",
        expect.any(Object),
                        );
    })

                it('should emit error events on task failure', async () => {
      localTask.execute = vi
        .fn()
        .mockRejectedValue(new Error('test error'))

                        queue.add(localTask)
                        const eventSpy = vi.spyOn(queue, 'emit')

                        try {
        await queue.executeTask(localTask.id)
                                await Promise.resolve() // Ensure all promises are settled
                        }
      catch (error) {
        console.error('Test error:', error)
                        }

      expect(eventSpy).toHaveBeenCalledWith('failed', expect.any(Object))
                })
        })

        describe('Queue Clear', () => {
    it('should clear all tasks and running state', () => {
      queue.add(localTask)
                        queue.clear()

                        expect(queue.getAll()).toHaveLength(0)
                        expect(queue.isRunning(localTask.id)).toBe(false)
                })
        })
})
