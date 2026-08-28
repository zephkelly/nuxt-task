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
      // Two attempts were made within this scheduled run: the failure and the
      // retry that succeeded. runCount counts attempts over the task lifetime.
      expect(localTask.metadata.runCount).toBe(2)
                })

                it('should respect max retries', async () => {
      // The retry budget is per scheduled run, so a lifetime runCount does not
      // consume it. This used to assert the opposite: that a task which had
      // already run four times would never execute again.
      localTask.metadata.runCount = 4
      localTask.options.retryDelay = 1
                        localTask.execute = vi
        .fn()
        .mockRejectedValue(new Error('test error'))

                        queue.add(localTask)
                        await queue.executeTask(localTask.id)

      // maxRetries: 3 means the initial attempt plus three retries.
      expect(localTask.execute).toHaveBeenCalledTimes(4)
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

    /**
     * Regression tests for two bugs that between them made the whole
     * retry/timeout/exclusive toolkit inoperative.
     *
     * Every pre-existing test above sets `timeout: 5000`, which is precisely
     * why the no-timeout path went unnoticed: the race only misbehaves when no
     * timeout is configured, and no production task set one.
     */
    describe('execution without a configured timeout', () => {
        function makeTask(overrides: Partial<CronTask> = {}): CronTask {
            return {
                id: 'no-timeout',
                name: 'No Timeout Task',
                status: 'pending',
                execute: vi.fn().mockResolvedValue('success'),
                options: {
                    expression: '* * * * *',
                },
                metadata: {
                    runCount: 0,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
                ...overrides,
            } as CronTask
        }

        it('waits for the handler before reporting completion', async () => {
            let resolveHandler: (v: unknown) => void = () => {}
            const handlerDone = new Promise((r) => {
                resolveHandler = r
            })

            const task = makeTask({ execute: vi.fn(() => handlerDone) as any })
            queue.add(task)

            const events: string[] = []
            queue.on('completed', () => events.push('completed'))

            const run = queue.executeTask(task.id)
            await Promise.resolve()
            await Promise.resolve()

            // The handler has not resolved yet, so nothing may be reported.
            expect(events).toEqual([])

            resolveHandler('done')
            await run

            expect(events).toEqual(['completed'])
        })

        it('reports the real handler result', async () => {
            const task = makeTask({ execute: vi.fn().mockResolvedValue('the-result') as any })
            queue.add(task)

            const results: unknown[] = []
            queue.on('completed', (event: any) => results.push(event.result))

            await queue.executeTask(task.id)

            expect(results).toEqual(['the-result'])
        })

        it('emits failed when the handler rejects', async () => {
            const task = makeTask({
                execute: vi.fn().mockRejectedValue(new Error('boom')) as any,
            })
            queue.add(task)

            const events: string[] = []
            queue.on('completed', () => events.push('completed'))
            queue.on('failed', () => events.push('failed'))

            await queue.executeTask(task.id)

            expect(events).toContain('failed')
            expect(events).not.toContain('completed')
        })

        it('records lastError when the handler rejects', async () => {
            const task = makeTask({
                execute: vi.fn().mockRejectedValue(new Error('boom')) as any,
            })
            queue.add(task)

            await queue.executeTask(task.id)

            expect(task.metadata.lastError?.message).toBe('boom')
            expect(task.status).toBe('failed')
        })

        it('reports the task as running while the handler is in flight', async () => {
            let resolveHandler: (v: unknown) => void = () => {}
            const handlerDone = new Promise((r) => {
                resolveHandler = r
            })

            const task = makeTask({ execute: vi.fn(() => handlerDone) as any })
            queue.add(task)

            const run = queue.executeTask(task.id)
            await Promise.resolve()

            expect(queue.isRunning(task.id)).toBe(true)

            resolveHandler('done')
            await run

            expect(queue.isRunning(task.id)).toBe(false)
        })

        it('honours exclusive while the handler is still in flight', async () => {
            let resolveHandler: (v: unknown) => void = () => {}
            const handlerDone = new Promise((r) => {
                resolveHandler = r
            })

            const execute = vi.fn(() => handlerDone)
            const task = makeTask({
                execute: execute as any,
                options: { expression: '* * * * *', exclusive: true },
            })
            queue.add(task)

            const first = queue.executeTask(task.id)
            await Promise.resolve()
            await queue.executeTask(task.id)

            expect(execute).toHaveBeenCalledTimes(1)

            resolveHandler('done')
            await first
        })

        it('still enforces a timeout when one is configured', async () => {
            const task = makeTask({
                execute: vi.fn(() => new Promise(() => {})) as any,
                options: { expression: '* * * * *', timeout: 10 },
            })
            queue.add(task)

            const events: string[] = []
            queue.on('failed', (event: any) => events.push(event.error.message))

            await queue.executeTask(task.id)

            expect(events).toEqual(['task timeout'])
        })
    })

    describe('retry budget is per scheduled run', () => {
        function makeRetryTask(overrides: Record<string, any> = {}, runCount = 0): CronTask {
            return {
                id: 'retry-task',
                name: 'Retry Task',
                status: 'pending',
                execute: vi.fn().mockResolvedValue('success'),
                options: {
                    expression: '* * * * *',
                    retryDelay: 1,
                    ...overrides,
                },
                metadata: {
                    runCount,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            } as CronTask
        }

        it('runs a recurring task that has already run many times', async () => {
            // runCount is a lifetime statistic. Gating on it meant
            // `maxRetries: 3` stopped a cron task forever after four ticks.
            const task = makeRetryTask({ maxRetries: 3 }, 10)
            queue.add(task)

            await queue.executeTask(task.id)

            expect(task.execute).toHaveBeenCalledTimes(1)
        })

        it('runs a task once when maxRetries is 0', async () => {
            // maxRetries: 0 reads as "do not retry", not "never run".
            const task = makeRetryTask({ maxRetries: 0 })
            queue.add(task)

            await queue.executeTask(task.id)

            expect(task.execute).toHaveBeenCalledTimes(1)
        })

        it('does not retry when maxRetries is 0 and the task fails', async () => {
            const task = makeRetryTask({ maxRetries: 0 })
            task.execute = vi.fn().mockRejectedValue(new Error('boom')) as any
            queue.add(task)

            await queue.executeTask(task.id)

            expect(task.execute).toHaveBeenCalledTimes(1)
        })

        it('retries up to maxRetries within a single scheduled run', async () => {
            const task = makeRetryTask({ maxRetries: 2 })
            task.execute = vi.fn().mockRejectedValue(new Error('boom')) as any
            queue.add(task)

            await queue.executeTask(task.id)

            // Initial attempt plus two retries.
            expect(task.execute).toHaveBeenCalledTimes(3)
        })

        it('stops retrying as soon as an attempt succeeds', async () => {
            const task = makeRetryTask({ maxRetries: 5 })
            task.execute = vi
                .fn()
                .mockRejectedValueOnce(new Error('boom'))
                .mockResolvedValue('success') as any
            queue.add(task)

            await queue.executeTask(task.id)

            expect(task.execute).toHaveBeenCalledTimes(2)
            expect(task.status).toBe('completed')
        })

        it('gives each scheduled run a fresh attempt budget', async () => {
            const task = makeRetryTask({ maxRetries: 1 })
            task.execute = vi.fn().mockRejectedValue(new Error('boom')) as any
            queue.add(task)

            await queue.executeTask(task.id)
            const afterFirstRun = (task.execute as any).mock.calls.length

            await queue.executeTask(task.id)

            expect(afterFirstRun).toBe(2)
            expect(task.execute).toHaveBeenCalledTimes(4)
        })

        it('keeps runCount as a lifetime attempt statistic', async () => {
            const task = makeRetryTask({ maxRetries: 1 }, 7)
            task.execute = vi.fn().mockRejectedValue(new Error('boom')) as any
            queue.add(task)

            await queue.executeTask(task.id)

            // Two attempts on top of the seven prior ones.
            expect(task.metadata.runCount).toBe(9)
        })

        it('cancels a pending retry when the task is removed', async () => {
            const task = makeRetryTask({ maxRetries: 3, retryDelay: 10000 })
            task.execute = vi.fn().mockRejectedValue(new Error('boom')) as any
            queue.add(task)

            const run = queue.executeTask(task.id)
            await Promise.resolve()
            await Promise.resolve()

            queue.remove(task.id)

            // Must settle without waiting out the 10s retry delay.
            await run

            expect(task.execute).toHaveBeenCalledTimes(1)
            expect(queue.isRunning(task.id)).toBe(false)
        })
    })
})
