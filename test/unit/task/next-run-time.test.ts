import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import { Scheduler } from '../../../src/runtime/scheduler'
import { MemoryStorage } from '../../../src/runtime/storage'
import type { ModuleOptions } from '../../../src/module'

/**
 * Next-run computation used to scan forward a minute at a time inside an
 * unbounded `while (true)`. An expression that can never match — `0 0 30 2 *`,
 * February 30th — spun that loop forever, and because the loop is synchronous
 * it wedged the whole Node process: not a slow task, a dead server.
 *
 * The search is now both coarse (it skips whole hours and days it cannot
 * match) and bounded by a horizon. The horizon has to be generous, because
 * legal expressions can legitimately be decades out: February 29th falling on
 * a given weekday recurs on a 28-year cycle.
 */

const moduleOptions: ModuleOptions = {
    serverTasks: true,
    clientTasks: false,
    storage: { type: 'memory' },
    timezone: { type: 'UTC', validate: true, strict: false },
}

describe('next run time computation', () => {
    let scheduler: Scheduler
    let storage: MemoryStorage

    beforeEach(async () => {
        storage = new MemoryStorage()
        await storage.init()
        await storage.clear()

        scheduler = new Scheduler(storage, moduleOptions, {
            tickInterval: 100,
            maxConcurrent: 2,
        })
    })

    afterEach(async () => {
        if (scheduler) await scheduler.stop()
        if (storage) await storage.clear()
        vi.restoreAllMocks()
    })

    describe('unsatisfiable expressions', () => {
        it('returns instead of hanging on February 30th', async () => {
            const task = await scheduler.addTask({
                name: 'never runs',
                options: { expression: '0 0 30 2 *' },
                execute: async () => 'never',
            })

            expect(task).toBeDefined()
        }, 10_000)

        it('emits an error event for an unsatisfiable expression', async () => {
            const errors: Error[] = []
            scheduler.on('error', (error: Error) => errors.push(error))

            await scheduler.addTask({
                name: 'never runs',
                options: { expression: '0 0 30 2 *' },
                execute: async () => 'never',
            })

            expect(errors.length).toBeGreaterThan(0)
        }, 10_000)

        it('does not schedule an unsatisfiable task to run', async () => {
            const task = await scheduler.addTask({
                name: 'never runs',
                options: { expression: '0 0 30 2 *' },
                execute: async () => 'never',
            })

            // Whatever fallback is used, it must not be due immediately.
            const nextRun = task.metadata.nextRun
            if (nextRun) {
                expect(nextRun.getTime()).toBeGreaterThan(Date.now())
            }
        }, 10_000)

        it('handles February 31st the same way', async () => {
            const task = await scheduler.addTask({
                name: 'also never runs',
                options: { expression: '0 0 31 2 *' },
                execute: async () => 'never',
            })

            expect(task).toBeDefined()
        }, 10_000)
    })

    describe('valid but distant expressions', () => {
        it('computes a real next run for February 29th', async () => {
            const task = await scheduler.addTask({
                name: 'leap day',
                options: { expression: '0 0 29 2 *' },
                execute: async () => 'leap',
            })

            expect(task.metadata.nextRun).toBeInstanceOf(Date)
            expect(task.metadata.nextRun!.getTime()).toBeGreaterThan(Date.now())

            // A leap day is at most four years out, never the 24h error fallback.
            const fourYearsMs = 4 * 366 * 24 * 60 * 60 * 1000
            expect(task.metadata.nextRun!.getTime() - Date.now())
                .toBeLessThan(fourYearsMs)
        }, 10_000)

        it('computes a real next run for a specific date each year', async () => {
            const task = await scheduler.addTask({
                name: 'new year',
                options: { expression: '0 0 1 1 *' },
                execute: async () => 'new year',
            })

            const oneYearMs = 366 * 24 * 60 * 60 * 1000
            expect(task.metadata.nextRun!.getTime() - Date.now())
                .toBeLessThan(oneYearMs)
        }, 10_000)
    })

    describe('ordinary expressions still resolve correctly', () => {
        it('schedules a five-minute task within five minutes', async () => {
            const task = await scheduler.addTask({
                name: 'frequent',
                options: { expression: '*/5 * * * *' },
                execute: async () => 'ok',
            })

            const delta = task.metadata.nextRun!.getTime() - Date.now()
            expect(delta).toBeGreaterThan(0)
            expect(delta).toBeLessThanOrEqual(5 * 60 * 1000 + 1000)
        })

        it('schedules a daily task within a day', async () => {
            const task = await scheduler.addTask({
                name: 'daily',
                options: { expression: '0 0 * * *' },
                execute: async () => 'ok',
            })

            const delta = task.metadata.nextRun!.getTime() - Date.now()
            expect(delta).toBeGreaterThan(0)
            expect(delta).toBeLessThanOrEqual(24 * 60 * 60 * 1000 + 1000)
        })

        it('schedules a weekly task within a week', async () => {
            const task = await scheduler.addTask({
                name: 'weekly',
                options: { expression: '0 0 * * 1' },
                execute: async () => 'ok',
            })

            const delta = task.metadata.nextRun!.getTime() - Date.now()
            expect(delta).toBeGreaterThan(0)
            expect(delta).toBeLessThanOrEqual(7 * 24 * 60 * 60 * 1000 + 1000)
        })

        it('respects a non-UTC task timezone', async () => {
            const task = await scheduler.addTask({
                name: 'tokyo daily',
                options: { expression: '0 0 * * *', timezone: 'Asia/Tokyo' },
                execute: async () => 'ok',
            })

            const delta = task.metadata.nextRun!.getTime() - Date.now()
            expect(delta).toBeGreaterThan(0)
            expect(delta).toBeLessThanOrEqual(24 * 60 * 60 * 1000 + 1000)
        })
    })
})
