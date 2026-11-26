import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createHooks } from 'hookable'

import { defineTaskHandler } from '../../../src/runtime/server/task/handler'
import { initializeNativeRuntime } from '../../../src/runtime/server/plugins/native'
import { triggerTask } from '../../../src/runtime/server/runs/trigger'
import { getRunningTasks, isTaskRunning } from '../../../src/runtime/server/runs/registry'
import { flushTaskRunHooks } from '../../../src/runtime/server/runs/hooks'
import { attachTaskRuntime, resetTaskRuntime } from '../../../src/runtime/server/runs/state'
import { moduleConfiguration, DEFAULT_MODULE_OPTIONS } from '../../../src/runtime/config'
import { createNitroRunTask, deferred, moduleOptionsFor } from './helpers'

/*
 * The conditions of a built app, which 1.3.0's unit tests did not reproduce:
 * the build-time module singleton holds only the defaults (custom mode), the
 * task module loads after nuxt-task's plugin has started, and nothing records
 * the definition's path name for it.
 */

const runtimeConfig = vi.hoisted(() => ({
    read: (): any => {
        throw new ReferenceError('useRuntimeConfig is not defined')
    },
}))

vi.mock('nitropack/dist/runtime/config', () => ({
    useRuntimeConfig: () => runtimeConfig.read(),
}))

vi.mock('nitropack/dist/runtime/task', () => ({
    runTask: vi.fn(),
}))

vi.mock('#nuxt-task/registry', () => ({
    taskRegistry: [
        { name: 'habit:demo', metaName: 'habit-demo', description: undefined, schedule: '* * * * *', options: {}, parked: false },
        { name: 'reports:weekly', metaName: 'weekly-report', description: undefined, schedule: '0 0 * * 0', options: {}, parked: false },
    ],
}))

const failingRead = () => {
    throw new ReferenceError('useRuntimeConfig is not defined')
}

function recordHooks() {
    const hooks = createHooks<any>()
    const starts: any[] = []
    hooks.hook('task:run:start', ({ run }: any) => {
        starts.push(run)
    })
    return { hooks, starts }
}

describe('run names in a built app', () => {
    let warnSpy: ReturnType<typeof vi.spyOn>
    let errorSpy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
        resetTaskRuntime()
        runtimeConfig.read = failingRead
        moduleConfiguration.setModuleOptions(DEFAULT_MODULE_OPTIONS)
        warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
        errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    })

    afterEach(() => {
        warnSpy.mockRestore()
        errorSpy.mockRestore()
        resetTaskRuntime()
        moduleConfiguration.setModuleOptions(DEFAULT_MODULE_OPTIONS)
    })

    describe('native mode, config unreadable, defaults in the singleton', () => {
        async function bootNative() {
            const { hooks, starts } = recordHooks()
            const tasks: Record<string, any> = {}
            const nitroRunTask = createNitroRunTask(tasks)

            // The real plugin function runs first, as in Nitro.
            await initializeNativeRuntime({ hooks }, nitroRunTask)

            // Then a task chunk loads, lazily, on first run.
            const load = (name: string, metaName: string, handler: () => Promise<unknown> = async () => ({ ok: true })) => {
                tasks[name] = defineTaskHandler({
                    meta: { name: metaName },
                    schedule: '* * * * *',
                    handler,
                })
                return tasks[name]
            }

            return { starts, nitroRunTask, load }
        }

        it('takes the native branch because the native plugin booted', async () => {
            const { load } = await bootNative()

            const task = load('habit:demo', 'habit-demo')

            expect(task).not.toHaveProperty('_custom')
            expect(warnSpy).not.toHaveBeenCalled()
        })

        it('names a scheduled run by the path name on Nitro\'s event', async () => {
            const { starts, nitroRunTask, load } = await bootNative()
            load('habit:demo', 'habit-demo')

            await nitroRunTask('habit:demo', { payload: { scheduledTime: 0 }, context: {} })
            await flushTaskRunHooks()

            expect(starts).toHaveLength(1)
            expect(starts[0]).toMatchObject({ name: 'habit:demo', metaName: 'habit-demo', trigger: 'schedule' })
        })

        it('reports the path name from getCurrentTaskRun, getRunningTasks and isTaskRunning', async () => {
            const { nitroRunTask, load } = await bootNative()
            const gate = deferred()
            let seen: any

            load('habit:demo', 'habit-demo', async () => {
                await gate.promise
                return {}
            })

            const running = nitroRunTask('habit:demo', { payload: {}, context: {} })
            await Promise.resolve()
            await Promise.resolve()

            seen = {
                running: getRunningTasks().map(r => r.name),
                byPath: isTaskRunning('habit:demo'),
                byMeta: isTaskRunning('habit-demo'),
            }
            gate.resolve()
            await running

            expect(seen).toEqual({ running: ['habit:demo'], byPath: true, byMeta: false })
        })

        it('triggerTask on a task whose meta.name differs resolves manual, no TaskAlreadyRunningError', async () => {
            const { starts, load } = await bootNative()
            load('reports:weekly', 'weekly-report', async () => ({ done: true }))

            const result = await triggerTask('reports:weekly', { triggeredBy: 'admin' })
            await flushTaskRunHooks()

            expect(result).toMatchObject({ joined: false, result: { done: true } })
            expect(starts).toHaveLength(1)
            expect(starts[0]).toMatchObject({
                name: 'reports:weekly',
                trigger: 'manual',
                triggeredBy: 'admin',
                runId: result.runId,
            })
        })

        it('triggerTask with wait: false resolves once started, without rejecting', async () => {
            const { starts, load } = await bootNative()
            const gate = deferred()
            load('reports:weekly', 'weekly-report', async () => {
                await gate.promise
                return {}
            })

            const result = await triggerTask('reports:weekly', { wait: false })

            expect(result).toMatchObject({ joined: false })
            expect(isTaskRunning('reports:weekly')).toBe(true)
            gate.resolve()
            await flushTaskRunHooks()
            expect(starts[0]).toMatchObject({ name: 'reports:weekly', trigger: 'manual' })
        })
    })

    describe('choosing the branch', () => {
        it('follows the runtime config when no plugin has started yet', () => {
            runtimeConfig.read = () => ({ nuxtTask: moduleOptionsFor('native') })

            const task = defineTaskHandler({
                meta: { name: 'habit-demo' },
                schedule: '* * * * *',
                handler: async () => ({}),
            })

            expect(task).not.toHaveProperty('_custom')
            expect(warnSpy).not.toHaveBeenCalled()
        })

        it('prefers the scheduler that booted over the runtime config', () => {
            runtimeConfig.read = () => ({ nuxtTask: moduleOptionsFor('native') })
            attachTaskRuntime({ mode: 'custom' })

            const task = defineTaskHandler({
                meta: { name: 'habit-demo' },
                schedule: '* * * * *',
                handler: async () => ({}),
            })

            expect(task).toHaveProperty('_custom')
        })

        it('falls back to the module options with one warning when nothing else is known', () => {
            moduleConfiguration.setModuleOptions(moduleOptionsFor('native'))

            const define = () => defineTaskHandler({
                meta: { name: 'habit-demo' },
                schedule: '* * * * *',
                handler: async () => ({}),
            })

            expect(define()).not.toHaveProperty('_custom')
            expect(define()).not.toHaveProperty('_custom')

            const fallbacks = warnSpy.mock.calls.filter(([m]) => String(m).includes('runtime config'))
            expect(fallbacks).toHaveLength(1)
            expect(String(fallbacks[0][0])).toContain('native scheduler')
        })

        it('treats a runtime config without nuxtTask as unreadable', () => {
            runtimeConfig.read = () => ({})

            defineTaskHandler({
                meta: { name: 'habit-demo' },
                schedule: '* * * * *',
                handler: async () => ({}),
            })

            expect(warnSpy.mock.calls.some(([m]) => String(m).includes('runtime config'))).toBe(true)
        })
    })

    describe('custom branch', () => {
        function bootCustom(registry: any[] = []) {
            const { hooks, starts } = recordHooks()
            attachTaskRuntime({ nitroApp: { hooks }, mode: 'custom', registry })
            return { starts }
        }

        it('uses the name on a Nitro runTask event', async () => {
            const { starts } = bootCustom()
            const task = defineTaskHandler({
                meta: { name: 'habit-demo' },
                schedule: '* * * * *',
                handler: async () => ({}),
            })

            await task.run({ name: 'habit:demo', payload: {}, context: {} })
            await flushTaskRunHooks()

            expect(starts[0]).toMatchObject({ name: 'habit:demo', metaName: 'habit-demo' })
            expect(warnSpy).not.toHaveBeenCalled()
        })

        it('passes the event to the handler untouched', async () => {
            bootCustom()
            const handler = vi.fn().mockResolvedValue({})
            const task = defineTaskHandler({
                meta: { name: 'habit-demo' },
                schedule: '* * * * *',
                handler,
            })

            await task.run({ name: 'habit:demo', payload: { a: 1 }, context: {} })

            expect(handler).toHaveBeenCalledWith({ name: 'habit:demo', payload: { a: 1 }, context: {} })
        })

        it('looks the path name up in the registry by meta.name when no name arrives', async () => {
            const { starts } = bootCustom([
                { name: 'habit:demo', metaName: 'habit-demo', description: undefined, schedule: '* * * * *', options: {}, parked: false },
            ])
            const task = defineTaskHandler({
                meta: { name: 'habit-demo' },
                schedule: '* * * * *',
                handler: async () => ({}),
            })

            await task.run({})
            await flushTaskRunHooks()

            expect(starts[0]).toMatchObject({ name: 'habit:demo' })
            expect(warnSpy).not.toHaveBeenCalled()
        })

        it('names the run by meta.name only when no path name is known, warning once', async () => {
            const { starts } = bootCustom([
                // Two files share a meta.name: the registry cannot decide.
                { name: 'a:demo', metaName: 'demo', description: undefined, schedule: '* * * * *', options: {}, parked: false },
                { name: 'b:demo', metaName: 'demo', description: undefined, schedule: '* * * * *', options: {}, parked: false },
            ])
            const task = defineTaskHandler({
                meta: { name: 'demo' },
                schedule: '* * * * *',
                handler: async () => ({}),
            })

            await task.run({})
            await task.run({})
            await flushTaskRunHooks()

            expect(starts.map(r => r.name)).toEqual(['demo', 'demo'])
            const metaWarnings = warnSpy.mock.calls.filter(([m]) => String(m).includes('meta.name'))
            expect(metaWarnings).toHaveLength(1)
        })
    })
})
