import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createHooks } from 'hookable'

import { addTasksToScheduler, createCustomTriggerAdapter } from '../../../src/runtime/plugin'
import { initializeNativeRuntime } from '../../../src/runtime/server/plugins/native'
import { Scheduler } from '../../../src/runtime/scheduler'
import { createMemoryStorage } from '../../../src/runtime/storage/environments/memory'
import { defineTaskHandler } from '../../../src/runtime/server/task/handler'
import { triggerTask } from '../../../src/runtime/server/runs/trigger'
import { listTasks } from '../../../src/runtime/server/runs/registry'
import { flushTaskRunHooks } from '../../../src/runtime/server/runs/hooks'
import { attachTaskRuntime, getRunState, resetTaskRuntime } from '../../../src/runtime/server/runs/state'
import { moduleConfiguration, DEFAULT_MODULE_OPTIONS } from '../../../src/runtime/config'
import { createNitroRunTask, moduleOptionsFor } from './helpers'

vi.mock('nitropack/dist/runtime/task', () => ({
    runTask: vi.fn(),
}))

vi.mock('#nuxt-task/registry', () => ({
    taskRegistry: [
        { name: 'db:migrate', metaName: 'Migrate', description: undefined, schedule: '0 0 * * *', options: {}, parked: false },
    ],
}))

describe('custom-mode plugin wiring', () => {
    let errorSpy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
        resetTaskRuntime()
        moduleConfiguration.setModuleOptions(moduleOptionsFor('custom'))
        errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    })

    afterEach(() => {
        errorSpy.mockRestore()
        resetTaskRuntime()
        moduleConfiguration.setModuleOptions(DEFAULT_MODULE_OPTIONS)
    })

    it('registers defineTaskHandler tasks by path name, leaving retries and timeout to the run', async () => {
        const scheduler = { addTask: vi.fn().mockResolvedValue(undefined) }
        const definition = defineTaskHandler({
            meta: { name: 'Free text name' },
            schedule: '0 0 * * *',
            options: { maxRetries: 3, retryDelay: 10, timeout: 500, exclusive: true, timezone: 'UTC' },
            handler: async () => ({}),
        })

        await addTasksToScheduler(scheduler, [definition as any], ['reports:weekly'])

        const added = scheduler.addTask.mock.calls[0][0]
        expect(added.name).toBe('reports:weekly')
        expect(added.options).toEqual({ expression: '0 0 * * *', exclusive: true, timezone: 'UTC' })
        expect(typeof added.execute).toBe('function')
    })

    it('runs through the real scheduler queue as one run per tick, retries included', async () => {
        const hooks = createHooks<any>()
        const finishes: any[] = []
        const failedAttempts: any[] = []
        hooks.hook('task:run:finish', (e: any) => { finishes.push(e) })
        hooks.hook('task:run:attempt-failed', (e: any) => { failedAttempts.push(e) })
        attachTaskRuntime({ nitroApp: { hooks }, mode: 'custom', registry: [] })

        let calls = 0
        const definition = defineTaskHandler({
            meta: { name: 'Flaky' },
            schedule: '*/5 * * * *',
            options: { maxRetries: 2, retryDelay: 1 },
            handler: async () => {
                calls++
                if (calls < 3) throw new Error(`attempt ${calls}`)
                return { ok: true }
            },
        })
        getRunState().definitionNames.set(definition, 'jobs:flaky')

        const scheduler = new Scheduler(await createMemoryStorage(), moduleOptionsFor('custom'), {
            tickInterval: 1000,
            maxConcurrent: 10,
        } as any)
        await addTasksToScheduler(scheduler, [definition as any], ['jobs:flaky'])

        const queued = (scheduler as any).queue.getAll()[0]
        const due = queued.metadata.nextRun
        await (scheduler as any).queue.executeTask(queued.id)
        await flushTaskRunHooks()

        expect(calls).toBe(3)
        expect(failedAttempts).toHaveLength(2)
        expect(finishes).toHaveLength(1)
        expect(finishes[0].run).toMatchObject({
            name: 'jobs:flaky',
            metaName: 'Flaky',
            trigger: 'schedule',
            scheduledFor: due,
            status: 'succeeded',
            attempt: 3,
        })
        expect(queued.metadata.runCount).toBe(1)
        expect(queued.status).toBe('completed')
    })

    it('triggers a task by path name with the payload merged into its context', async () => {
        const handler = vi.fn(async (_ctx: any) => ({ done: true }))
        const definition = defineTaskHandler({
            meta: { name: 'Migrate' },
            schedule: '0 0 * * *',
            handler,
        })
        attachTaskRuntime({
            mode: 'custom',
            registry: [{ name: 'db:migrate', metaName: 'Migrate', description: undefined, schedule: '0 0 * * *', options: {}, parked: false }],
            adapter: createCustomTriggerAdapter([{ name: 'db:migrate', definition: definition as any }], moduleOptionsFor('custom')),
        })

        const res = await triggerTask('db:migrate', { payload: { dryRun: true, name: 'spoof' } })

        expect(res.result).toEqual({ done: true })
        expect(handler.mock.calls[0][0]).toMatchObject({ dryRun: true, name: 'db:migrate', timezone: 'UTC' })
    })
})

describe('native-mode plugin', () => {
    afterEach(() => {
        resetTaskRuntime()
        moduleConfiguration.setModuleOptions(DEFAULT_MODULE_OPTIONS)
    })

    it('attaches Nitro\'s runTask, the hooks and the registry, and flushes hooks on close', async () => {
        resetTaskRuntime()
        moduleConfiguration.setModuleOptions(moduleOptionsFor('native'))

        const hooks = createHooks<any>()
        const starts: any[] = []
        hooks.hook('task:run:start', (e: any) => { starts.push(e) })

        const definition = defineTaskHandler({
            meta: { name: 'Migrate' },
            schedule: '0 0 * * *',
            handler: async () => ({ migrated: 1 }),
        })
        const nitroRunTask = vi.fn(createNitroRunTask({ 'db:migrate': definition }))

        await initializeNativeRuntime({ hooks }, nitroRunTask)

        expect(listTasks().map(t => t.name)).toEqual(['db:migrate'])

        const res = await triggerTask('db:migrate', { payload: { a: 1 }, runId: 'n1' })
        expect(res).toEqual({ runId: 'n1', joined: false, result: { migrated: 1 } })
        expect(nitroRunTask).toHaveBeenCalledWith('db:migrate', { payload: { a: 1 }, context: {} })

        await hooks.callHook('close')
        expect(starts.map(s => s.run.runId)).toEqual(['n1'])
    })
})
