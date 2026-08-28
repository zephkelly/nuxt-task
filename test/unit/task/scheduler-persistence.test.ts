import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import { Scheduler } from '../../../src/runtime/scheduler'
import { MemoryStorage } from '../../../src/runtime/storage'
import { moduleConfiguration, DEFAULT_MODULE_OPTIONS } from '../../../src/runtime/config'
import type { ModuleOptions } from '../../../src/module'

const flexibleOptions: ModuleOptions = {
    serverTasks: true,
    clientTasks: false,
    storage: { type: 'memory' },
    timezone: { type: 'UTC', validate: true, strict: false },
}

const strictOptions: ModuleOptions = {
    serverTasks: true,
    clientTasks: false,
    storage: { type: 'memory' },
    timezone: { type: 'UTC', validate: true, strict: true },
}

describe('scheduler persistence', () => {
    let scheduler: Scheduler
    let storage: MemoryStorage

    const setup = async (options: ModuleOptions) => {
        storage = new MemoryStorage()
        await storage.init()
        await storage.clear()

        moduleConfiguration.setModuleOptions(options)

        scheduler = new Scheduler(storage, options, {
            tickInterval: 100,
            maxConcurrent: 5,
        })

        return scheduler
    }

    beforeEach(async () => {
        await setup(flexibleOptions)
    })

    afterEach(async () => {
        if (scheduler) await scheduler.stop()
        if (storage) await storage.clear()
        moduleConfiguration.setModuleOptions(DEFAULT_MODULE_OPTIONS)
        vi.restoreAllMocks()
    })

    describe('removeTask', () => {
        it('removes the task from storage as well as the queue', async () => {
            const task = await scheduler.addTask({
                name: 'doomed',
                options: { expression: '0 0 * * *' },
                execute: async () => 'ok',
            })

            expect(await storage.get(task.id)).toBeDefined()

            await scheduler.removeTask(task.id)

            // The task used to be deleted from the queue but left behind in
            // storage, so restore() resurrected it on the next boot.
            expect(await storage.get(task.id)).toBeFalsy()
        })

        it('leaves other tasks in storage untouched', async () => {
            const keep = await scheduler.addTask({
                name: 'keep',
                options: { expression: '0 0 * * *' },
                execute: async () => 'ok',
            })
            const drop = await scheduler.addTask({
                name: 'drop',
                options: { expression: '0 0 * * *' },
                execute: async () => 'ok',
            })

            await scheduler.removeTask(drop.id)

            expect(await storage.get(keep.id)).toBeDefined()
        })

        it('does not touch storage when the task was not queued', async () => {
            const removeSpy = vi.spyOn(storage, 'remove')

            await scheduler.removeTask('does-not-exist')

            expect(removeSpy).not.toHaveBeenCalled()
        })
    })

    describe('targeted writes', () => {
        it('persists only the task that changed when adding', async () => {
            for (let i = 0; i < 4; i++) {
                await scheduler.addTask({
                    name: `existing ${i}`,
                    options: { expression: '0 0 * * *' },
                    execute: async () => 'ok',
                })
            }

            const addSpy = vi.spyOn(storage, 'add')
            const updateSpy = vi.spyOn(storage, 'update')

            await scheduler.addTask({
                name: 'the new one',
                options: { expression: '0 0 * * *' },
                execute: async () => 'ok',
            })

            // Adding one task rewrote every task in the queue.
            const writes = addSpy.mock.calls.length + updateSpy.mock.calls.length
            expect(writes).toBe(1)
        })
    })

    describe('strict timezone enforcement', () => {
        it('forces the module timezone in strict mode', async () => {
            await setup(strictOptions)

            // Strict enforcement used to be skipped whenever process.env.VITEST
            // was set, so this behaviour differed between tests and production
            // and was never actually covered.
            expect(scheduler.getActiveTimezone({
                expression: '0 0 * * *',
                timezone: 'Asia/Tokyo',
            })).toBe('UTC')
        })

        it('allows a per-task timezone when not strict', async () => {
            expect(scheduler.getActiveTimezone({
                expression: '0 0 * * *',
                timezone: 'Asia/Tokyo',
            })).toBe('Asia/Tokyo')
        })

        it('rejects an invalid module timezone in strict mode', async () => {
            // Construction validates first, so an unusable strict timezone
            // never reaches getActiveTimezone.
            await expect(setup({
                ...strictOptions,
                timezone: { type: 'Not/AZone', validate: true, strict: true },
            })).rejects.toThrow('Invalid timezone')
        })
    })
})
