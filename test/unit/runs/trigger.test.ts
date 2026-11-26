import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import { triggerTask } from '../../../src/runtime/server/runs/trigger'
import { getCurrentTaskRun, getRunningTasks, isTaskRunning } from '../../../src/runtime/server/runs/registry'
import {
    TaskAlreadyRunningError,
    TaskNotFoundError,
    TaskRuntimeNotReadyError,
} from '../../../src/runtime/server/runs/errors'
import { resetTaskRuntime, getRunState } from '../../../src/runtime/server/runs/state'
import { moduleConfiguration, DEFAULT_MODULE_OPTIONS } from '../../../src/runtime/config'
import { createHarness, deferred, finishEvents, type Harness, type Mode } from './helpers'

describe.each<Mode>(['native', 'custom'])('triggerTask (%s mode)', (mode) => {
    let h: Harness
    let errorSpy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
        h = createHarness(mode)
        errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    })

    afterEach(() => {
        errorSpy.mockRestore()
        resetTaskRuntime()
        moduleConfiguration.setModuleOptions(DEFAULT_MODULE_OPTIONS)
    })

    it('runs the task with trigger manual and resolves with the raw result', async () => {
        const handler = vi.fn(async (_ctx: any) => ({ sent: 1 }))
        h.define('send', { handler })

        const res = await triggerTask('send', {
            payload: { userId: 7 },
            runId: 'row-42',
            triggeredBy: 'admin:3',
        })
        await h.flush()

        expect(res).toEqual({ runId: 'row-42', joined: false, result: { sent: 1 } })
        expect(handler.mock.calls[0][0]).toMatchObject({ userId: 7, name: 'send' })

        const [finish] = finishEvents(h)
        expect(finish.run).toMatchObject({
            runId: 'row-42',
            name: 'send',
            trigger: 'manual',
            triggeredBy: 'admin:3',
            scheduledFor: null,
        })
    })

    it('generates a UUID when no runId is given', async () => {
        h.define('t', { handler: async () => ({}) })
        const { runId } = await triggerTask('t')
        expect(runId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    })

    it('rejects with TaskAlreadyRunningError while the task runs', async () => {
        const gate = deferred()
        const handler = vi.fn(async () => { await gate.promise; return {} })
        h.define('busy', { handler })

        const first = triggerTask('busy', { runId: 'first' })
        const error = await triggerTask('busy', { payload: { lost: true } }).catch(e => e)

        expect(error).toBeInstanceOf(TaskAlreadyRunningError)
        expect(error.taskName).toBe('busy')
        expect(error.runId).toBe('first')

        gate.resolve()
        await first
        expect(handler).toHaveBeenCalledTimes(1)
    })

    it('rejects while a scheduled run is open', async () => {
        const gate = deferred()
        h.define('sched', { handler: async () => { await gate.promise; return {} } })

        const scheduled = h.fire('sched')
        await new Promise(resolve => setTimeout(resolve, 1))

        const error = await triggerTask('sched').catch(e => e)
        expect(error).toBeInstanceOf(TaskAlreadyRunningError)
        expect(error.runId).toBe(getRunningTasks()[0].runId)

        gate.resolve()
        await scheduled
    })

    it('starts exactly one run for two calls in the same tick', async () => {
        const handler = vi.fn(async () => ({}))
        h.define('race', { handler })

        const results = await Promise.allSettled([
            triggerTask('race'),
            triggerTask('race'),
        ])

        expect(results.map(r => r.status).sort()).toEqual(['fulfilled', 'rejected'])
        const rejected = results.find(r => r.status === 'rejected') as PromiseRejectedResult
        expect(rejected.reason).toBeInstanceOf(TaskAlreadyRunningError)
        expect(handler).toHaveBeenCalledTimes(1)
    })

    it('joins the open run on request and ignores the joiner\'s payload', async () => {
        const gate = deferred()
        const handler = vi.fn(async (ctx: any) => { await gate.promise; return { from: ctx.who } })
        h.define('shared', { handler })

        const first = triggerTask('shared', { payload: { who: 'first' }, runId: 'r1' })
        const joined = triggerTask('shared', { payload: { who: 'second' }, ifRunning: 'join' })

        gate.resolve()
        expect(await first).toEqual({ runId: 'r1', joined: false, result: { from: 'first' } })
        expect(await joined).toEqual({ runId: 'r1', joined: true, result: { from: 'first' } })
        expect(handler).toHaveBeenCalledTimes(1)
    })

    it('joins without waiting when wait is false', async () => {
        const gate = deferred()
        h.define('j', { handler: async () => { await gate.promise; return {} } })

        const first = triggerTask('j', { runId: 'r1' })
        await expect(triggerTask('j', { ifRunning: 'join', wait: false }))
            .resolves.toEqual({ runId: 'r1', joined: true })

        gate.resolve()
        await first
    })

    it('a joiner receives the open run\'s failure', async () => {
        const gate = deferred()
        const original = new Error('shared failure')
        h.define('jf', { handler: async () => { await gate.promise; throw original } })

        const first = triggerTask('jf').catch(e => e)
        const joined = triggerTask('jf', { ifRunning: 'join' }).catch(e => e)
        gate.resolve()

        expect(await first).toBe(original)
        expect(await joined).toBe(original)
    })

    it('with wait: false resolves once the run has started', async () => {
        const gate = deferred()
        h.define('bg', { handler: async () => { await gate.promise; return { late: true } } })

        const res = await triggerTask('bg', { wait: false, runId: 'bg-1' })

        expect(res).toEqual({ runId: 'bg-1', joined: false })
        expect(isTaskRunning('bg')).toBe(true)
        expect(getRunningTasks()[0]).toMatchObject({ runId: 'bg-1', status: 'running', trigger: 'manual' })

        gate.resolve()
        await new Promise(resolve => setTimeout(resolve, 1))
        await h.flush()
        expect(finishEvents(h)[0].result).toEqual({ late: true })
    })

    it('with wait: false a later failure is not an unhandled rejection', async () => {
        const unhandled = vi.fn()
        process.on('unhandledRejection', unhandled)
        try {
            h.define('bgfail', { handler: async () => { await new Promise(r => setTimeout(r, 2)); throw new Error('later') } })
            await triggerTask('bgfail', { wait: false })
            await new Promise(resolve => setTimeout(resolve, 20))
            await h.flush()

            expect(finishEvents(h)[0].status).toBe('failed')
            expect(unhandled).not.toHaveBeenCalled()
        }
        finally {
            process.off('unhandledRejection', unhandled)
        }
    })

    it('rethrows the handler error when waiting', async () => {
        const original = new Error('manual failure')
        h.define('mf', { handler: async () => { throw original } })
        await expect(triggerTask('mf')).rejects.toBe(original)
        expect(isTaskRunning('mf')).toBe(false)
    })

    it('throws TaskNotFoundError for an unknown task', async () => {
        h.define('known', { handler: async () => ({}) })
        await expect(triggerTask('unknown')).rejects.toBeInstanceOf(TaskNotFoundError)
    })

    it('rejects a runId that is already open', async () => {
        const gate = deferred()
        h.define('one', { handler: async () => { await gate.promise; return {} } })
        h.define('two', { handler: async () => ({}) })

        const first = triggerTask('one', { runId: 'dup' })
        await expect(triggerTask('two', { runId: 'dup' })).rejects.toThrow('already open')

        gate.resolve()
        await first
    })

    it('throws TaskRuntimeNotReadyError before a plugin has attached', async () => {
        resetTaskRuntime()
        await expect(triggerTask('anything')).rejects.toBeInstanceOf(TaskRuntimeNotReadyError)
    })

    describe('the trigger cannot be spoofed', () => {
        const spoof = {
            trigger: 'manual',
            runId: 'spoofed-id',
            triggeredBy: 'spoofed-user',
            scheduledFor: '2000-01-01T00:00:00.000Z',
            taskTrigger: 'manual',
        }

        it('a scheduled run stays schedule whatever the payload says', async () => {
            const handler = vi.fn(async (_ctx: any) => ({}))
            h.define('s', { handler })

            await h.fire('s', { payload: spoof })
            await h.flush()

            const run = finishEvents(h)[0].run
            expect(run.trigger).toBe('schedule')
            expect(run.runId).not.toBe('spoofed-id')
            expect(run.triggeredBy).toBeUndefined()
            expect(run.scheduledFor).not.toEqual(new Date('2000-01-01T00:00:00.000Z'))
            // The payload still reaches the handler untouched.
            expect(handler.mock.calls[0][0]).toMatchObject({ taskTrigger: 'manual' })
        })

        it('a manual run stays manual whatever the payload says', async () => {
            h.define('m', { handler: async () => ({}) })

            await triggerTask('m', {
                payload: { ...spoof, trigger: 'schedule' },
                triggeredBy: 'real-user',
            })
            await h.flush()

            const run = finishEvents(h)[0].run
            expect(run.trigger).toBe('manual')
            expect(run.triggeredBy).toBe('real-user')
            expect(run.runId).not.toBe('spoofed-id')
            expect(run.scheduledFor).toBeNull()
        })

        it('a run started inside another run is manual, not schedule', async () => {
            h.define('child', { handler: async () => ({}) })
            h.define('parent', {
                handler: async () => {
                    // A handler that starts another task directly.
                    await h.fire('child')
                    return {}
                },
            })

            await h.fire('parent')
            await h.flush()

            const child = finishEvents(h).find(f => f.run.name === 'child')
            expect(child.run.trigger).toBe('manual')
            expect(child.run.triggeredBy).toBeUndefined()
        })

        it('a triggerTask inside a handler gets its own run, not the parent\'s reservation', async () => {
            h.define('inner', { handler: async () => ({ inner: getCurrentTaskRun()!.runId }) })
            h.define('outer', {
                handler: async () => {
                    const { result } = await triggerTask('inner', { runId: 'inner-run' })
                    return { result }
                },
            })

            const res = await triggerTask('outer', { runId: 'outer-run' })
            expect(res.result).toEqual({ result: { inner: 'inner-run' } })
        })
    })
})

describe('triggerTask without AsyncLocalStorage', () => {
    afterEach(() => {
        resetTaskRuntime()
        moduleConfiguration.setModuleOptions(DEFAULT_MODULE_OPTIONS)
    })

    it('still marks the run manual through the reservation map', async () => {
        const h = createHarness('native')
        const state = getRunState()
        state.runStore = undefined
        state.triggerStore = undefined

        h.define('noals', { handler: async () => ({}) })
        await triggerTask('noals', { runId: 'x' })
        await h.flush()

        expect(finishEvents(h)[0].run).toMatchObject({ runId: 'x', trigger: 'manual' })
    })
})
