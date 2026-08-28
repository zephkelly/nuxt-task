import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import { Scheduler } from '../../../src/runtime/scheduler'
import { MemoryStorage } from '../../../src/runtime/storage'
import CronExpressionParser from '../../../src/runtime/expression/parser'
import type { ModuleOptions } from '../../../src/module'

/**
 * The tick runs once a second for every task in the queue, so anything it does
 * per task is on the hottest path the module has.
 *
 * It used to re-parse each task's cron expression on every tick purely to read
 * back the timezone it had just computed itself, which also meant one task
 * with a bad timezone threw inside the filter and stopped every other task
 * from running that tick.
 */

const moduleOptions: ModuleOptions = {
    serverTasks: true,
    clientTasks: false,
    storage: { type: 'memory' },
    timezone: { type: 'UTC', validate: true, strict: false },
}

describe('scheduler tick', () => {
    let scheduler: Scheduler
    let storage: MemoryStorage

    beforeEach(async () => {
        storage = new MemoryStorage()
        await storage.init()
        await storage.clear()

        scheduler = new Scheduler(storage, moduleOptions, {
            tickInterval: 100,
            maxConcurrent: 5,
        })
    })

    afterEach(async () => {
        if (scheduler) await scheduler.stop()
        if (storage) await storage.clear()
        vi.restoreAllMocks()
    })

    /**
     * Runs one tick deterministically instead of waiting on the interval.
     * tick() no-ops unless the scheduler is running, so flip that flag rather
     * than start() an interval the test would then race against.
     */
    const runTick = async () => {
        ;(scheduler as any).running = true
        await (scheduler as any).tick()
    }

    describe('per-tick work', () => {
        it('does not parse cron expressions for tasks that are not due', async () => {
            await scheduler.addTask({
                name: 'not due yet',
                options: { expression: '0 0 1 1 *' },
                execute: async () => 'ok',
            })

            const parseSpy = vi.spyOn(
                CronExpressionParser,
                'parseCronExpression',
            )

            await runTick()

            expect(parseSpy).not.toHaveBeenCalled()
        })

        it('does not parse per task when several tasks are queued', async () => {
            for (let i = 0; i < 5; i++) {
                await scheduler.addTask({
                    name: `task ${i}`,
                    options: { expression: '0 0 1 1 *' },
                    execute: async () => 'ok',
                })
            }

            const parseSpy = vi.spyOn(
                CronExpressionParser,
                'parseCronExpression',
            )

            await runTick()

            expect(parseSpy).not.toHaveBeenCalled()
        })

        it('keeps running other tasks when one has an unusable timezone', async () => {
            const good = vi.fn().mockResolvedValue('ok')

            const broken = await scheduler.addTask({
                name: 'broken timezone',
                options: { expression: '* * * * *' },
                execute: async () => 'never',
            })

            await scheduler.addTask({
                name: 'healthy',
                options: { expression: '* * * * *' },
                execute: good,
            })

            // Corrupt the task after validation, the way a restored or
            // hand-edited task could arrive.
            const queued = (scheduler as any).queue.get(broken.id)
            queued.options.timezone = 'Not/AZone'
            queued.metadata.nextRun = new Date(Date.now() - 1000)

            const healthy = (scheduler as any).queue
                .getAll()
                .find((t: any) => t.name === 'healthy')
            healthy.metadata.nextRun = new Date(Date.now() - 1000)

            await runTick()

            expect(good).toHaveBeenCalled()
        })
    })

    describe('next run bookkeeping', () => {
        it('advances nextRun after a successful run', async () => {
            const task = await scheduler.addTask({
                name: 'succeeds',
                options: { expression: '* * * * *' },
                execute: async () => 'ok',
            })

            const queued = (scheduler as any).queue.get(task.id)
            queued.metadata.nextRun = new Date(Date.now() - 1000)

            await runTick()

            expect(queued.metadata.nextRun.getTime()).toBeGreaterThan(Date.now())
        })

        it('advances nextRun after a failed run', async () => {
            // A failed task used to keep its stale past nextRun, so it was due
            // again on the very next tick, every tick.
            const task = await scheduler.addTask({
                name: 'fails',
                options: { expression: '* * * * *' },
                execute: async () => {
                    throw new Error('boom')
                },
            })

            const queued = (scheduler as any).queue.get(task.id)
            queued.metadata.nextRun = new Date(Date.now() - 1000)

            await runTick()

            expect(queued.metadata.nextRun.getTime()).toBeGreaterThan(Date.now())
        })

        it('does not re-run a failed task on the following tick', async () => {
            const execute = vi.fn().mockRejectedValue(new Error('boom'))

            const task = await scheduler.addTask({
                name: 'fails repeatedly',
                options: { expression: '0 0 1 1 *' },
                execute,
            })

            const queued = (scheduler as any).queue.get(task.id)
            queued.metadata.nextRun = new Date(Date.now() - 1000)

            await runTick()
            await runTick()
            await runTick()

            expect(execute).toHaveBeenCalledTimes(1)
        })
    })

    describe('stats', () => {
        it('reports queued tasks without waiting for a tick', async () => {
            await scheduler.addTask({
                name: 'queued',
                options: { expression: '0 0 1 1 *' },
                execute: async () => 'ok',
            })

            expect(scheduler.getStats().queuedTasks).toBe(1)
        })

        it('reports an empty queue as zero', () => {
            expect(scheduler.getStats().queuedTasks).toBe(0)
        })
    })
})
