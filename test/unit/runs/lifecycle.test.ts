import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import { getCurrentTaskRun, getRunningTasks, isTaskRunning } from '../../../src/runtime/server/runs/registry'
import { TaskTimeoutError } from '../../../src/runtime/server/runs/errors'
import { resetTaskRuntime } from '../../../src/runtime/server/runs/state'
import { moduleConfiguration, DEFAULT_MODULE_OPTIONS } from '../../../src/runtime/config'
import { createHarness, deferred, finishEvents, type Harness, type Mode } from './helpers'

describe.each<Mode>(['native', 'custom'])('run lifecycle (%s mode)', (mode) => {
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

    describe('status', () => {
        it('is succeeded when the handler returns', async () => {
            h.define('ok', { handler: async () => ({ sent: 3 }) })
            await h.fire('ok')
            await h.flush()

            const [finish] = finishEvents(h)
            expect(finish.status).toBe('succeeded')
            expect(finish.run.status).toBe('succeeded')
            expect(finish.run.name).toBe('ok')
            expect(finish.run.metaName).toBe('Meta ok')
            expect(finish.run.finishedAt).toBeInstanceOf(Date)
            expect(finish.durationMs).toBeGreaterThanOrEqual(0)
        })

        it('is failed when the handler throws', async () => {
            h.define('boom', { handler: async () => { throw new Error('nope') } })
            await expect(h.fire('boom')).rejects.toThrow('nope')
            await h.flush()

            const [finish] = finishEvents(h)
            expect(finish.status).toBe('failed')
            expect(finish.error).toBeInstanceOf(Error)
            expect(finish.result).toBeUndefined()
        })

        it('is skipped when the handler returns { skipped: true }', async () => {
            h.define('skip', { handler: async () => ({ skipped: true, reason: 'quiet hours' }) })
            const returned = await h.fire('skip')
            await h.flush()

            expect(finishEvents(h)[0].status).toBe('skipped')
            expect(returned).toEqual({ success: true, skipped: true, reason: 'quiet hours' })
        })

        it('is timed-out when the last attempt exceeds the timeout', async () => {
            h.define('slow', {
                options: { timeout: 10 },
                handler: () => new Promise(resolve => setTimeout(resolve, 200)),
            })
            const error = await h.fire('slow').catch(e => e)
            await h.flush()

            expect(error).toBeInstanceOf(TaskTimeoutError)
            expect(error.message).toBe('task timeout')
            expect(finishEvents(h)[0].status).toBe('timed-out')
        })

        it('treats retries as one run and reports each failed attempt', async () => {
            let calls = 0
            h.define('flaky', {
                options: { maxRetries: 2, retryDelay: 1 },
                handler: async () => {
                    calls++
                    if (calls < 3) throw new Error(`attempt ${calls}`)
                    return { done: true }
                },
            })

            await h.fire('flaky')
            await h.flush()

            const starts = h.events.filter(e => e.hook === 'task:run:start')
            const failedAttempts = h.events.filter(e => e.hook === 'task:run:attempt-failed')
            const [finish] = finishEvents(h)

            expect(calls).toBe(3)
            expect(starts).toHaveLength(1)
            expect(failedAttempts.map(e => e.event.attempt)).toEqual([1, 2])
            expect(failedAttempts[0].event.retryInMs).toBe(1)
            expect(failedAttempts[0].event.error.message).toBe('attempt 1')
            expect(finish.status).toBe('succeeded')
            expect(finish.run.attempt).toBe(3)
            expect(finish.run.maxAttempts).toBe(3)
            expect(new Set(h.events.map(e => e.event.run.runId)).size).toBe(1)
        })

        it('is failed after retries run out, and timed-out only if the last attempt timed out', async () => {
            let calls = 0
            h.define('mixed', {
                options: { maxRetries: 1, retryDelay: 1, timeout: 10 },
                handler: () => {
                    calls++
                    return calls === 1
                        ? new Promise(resolve => setTimeout(resolve, 200))
                        : Promise.reject(new Error('second'))
                },
            })

            await expect(h.fire('mixed')).rejects.toThrow('second')
            await h.flush()
            expect(finishEvents(h)[0].status).toBe('failed')
        })
    })

    describe('passthrough', () => {
        it('gives hooks the raw handler result and keeps run()\'s return shape', async () => {
            const raw = { sent: 2, ids: [1, 2] }
            h.define('raw', { handler: async () => raw })

            const returned = await h.fire('raw')
            await h.flush()

            expect(returned).toEqual({ success: true, sent: 2, ids: [1, 2] })
            expect(finishEvents(h)[0].result).toBe(raw)
        })

        it('rethrows the exact error object', async () => {
            const original = new TypeError('exact')
            h.define('exact', { handler: async () => { throw original } })

            const thrown = await h.fire('exact').catch(e => e)
            await h.flush()

            expect(thrown).toBe(original)
            expect(finishEvents(h)[0].error).toBe(original)
        })

        it('still wraps a non-Error throw as before', async () => {
            h.define('str', { handler: async () => { throw 'a string' } })
            await expect(h.fire('str')).rejects.toThrow('Unknown error in task execution')
        })

        it('logs failures under the path name', async () => {
            h.define('reports:weekly', { handler: async () => { throw new Error('x') } })
            await h.fire('reports:weekly').catch(() => {})

            expect(errorSpy).toHaveBeenCalledWith(
                '[ nuxt-task ] Task "reports:weekly" failed:',
                expect.any(Error),
            )
        })
    })

    describe('hooks never affect the run', () => {
        it('a throwing hook leaves the run, its result and other listeners untouched', async () => {
            h.hooks.hook('task:run:start', () => { throw new Error('start listener') })
            h.hooks.hook('task:run:finish', async () => { throw new Error('finish listener') })
            const later = vi.fn()
            h.hooks.hook('task:run:finish', later)

            h.define('safe', { handler: async () => ({ ok: 1 }) })
            const returned = await h.fire('safe')
            await h.flush()

            expect(returned).toEqual({ success: true, ok: 1 })
            expect(finishEvents(h)[0].status).toBe('succeeded')
            expect(later).toHaveBeenCalledTimes(1)
            const hookLogs = errorSpy.mock.calls.filter(c => String(c[0]).includes('hook failed'))
            expect(hookLogs).toHaveLength(2)
        })

        it('a throwing hook does not change a failure into anything else', async () => {
            h.hooks.hook('task:run:finish', () => { throw new Error('listener') })
            const original = new Error('real failure')
            h.define('fails', { handler: async () => { throw original } })

            await expect(h.fire('fails')).rejects.toBe(original)
        })

        it('a hook that never settles does not delay the run', async () => {
            h.hooks.hook('task:run:start', () => new Promise(() => {}))
            h.define('fast', { handler: async () => ({ ok: true }) })

            const started = performance.now()
            await h.fire('fast')
            expect(performance.now() - started).toBeLessThan(50)
            expect(isTaskRunning('fast')).toBe(false)
        })

        it('calls a run\'s finish listeners only after its start listeners settle', async () => {
            const order: string[] = []
            const gate = deferred()
            h.hooks.hook('task:run:start', async () => {
                await gate.promise
                order.push('start')
            })
            h.hooks.hook('task:run:finish', () => {
                order.push('finish')
            })

            h.define('ordered', { handler: async () => ({}) })
            await h.fire('ordered')
            expect(order).toEqual([])

            gate.resolve()
            await h.flush()
            expect(order).toEqual(['start', 'finish'])
        })

        it('runs listeners outside the run context', async () => {
            let seen: unknown = 'unset'
            h.hooks.hook('task:run:finish', () => {
                seen = getCurrentTaskRun()
            })
            h.define('ctx', { handler: async () => ({}) })
            await h.fire('ctx')
            await h.flush()

            expect(seen).toBeUndefined()
        })
    })

    describe('run context', () => {
        async function deepHelper() {
            await new Promise(resolve => setTimeout(resolve, 1))
            return getCurrentTaskRun()
        }

        it('exposes the open run to code deep inside the handler', async () => {
            let inside: any
            h.define('deep', {
                handler: async () => {
                    inside = await deepHelper()
                    return {}
                },
            })
            await h.fire('deep')

            expect(inside.name).toBe('deep')
            expect(inside.status).toBe('succeeded') // live view, read after the run closed
            expect(inside.runId).toMatch(/^[0-9a-f-]{36}$/)
            expect(getCurrentTaskRun()).toBeUndefined()
        })

        it('keeps concurrent runs in separate contexts', async () => {
            const gateA = deferred()
            const gateB = deferred()
            const seen: Record<string, string[]> = { a: [], b: [] }

            const body = (key: 'a' | 'b', gate: Promise<void>) => async () => {
                seen[key].push(getCurrentTaskRun()!.name)
                getCurrentTaskRun()!.meta.owner = key
                await gate
                seen[key].push((await deepHelper())!.name)
                seen[key].push(String(getCurrentTaskRun()!.meta.owner))
                return {}
            }

            h.define('a', { handler: body('a', gateA.promise) })
            h.define('b', { handler: body('b', gateB.promise) })

            const runA = h.fire('a')
            const runB = h.fire('b')
            await new Promise(resolve => setTimeout(resolve, 5))
            expect(getRunningTasks().map(r => r.name).sort()).toEqual(['a', 'b'])

            gateB.resolve()
            gateA.resolve()
            await Promise.all([runA, runB])
            await h.flush()

            expect(seen).toEqual({ a: ['a', 'a', 'a'], b: ['b', 'b', 'b'] })
            const finishes = finishEvents(h)
            expect(finishes.find(f => f.run.name === 'a').run.meta).toEqual({ owner: 'a' })
            expect(finishes.find(f => f.run.name === 'b').run.meta).toEqual({ owner: 'b' })
        })

        it('carries meta written in the handler to task:run:finish, not to start', async () => {
            h.define('traced', {
                handler: async () => {
                    getCurrentTaskRun()!.meta.traceId = 'abc'
                    return {}
                },
            })
            await h.fire('traced')
            await h.flush()

            const start = h.events.find(e => e.hook === 'task:run:start')!.event
            expect(start.run.meta).toEqual({})
            expect(finishEvents(h)[0].run.meta).toEqual({ traceId: 'abc' })
        })

        it('does not let a handler rewrite the run\'s identity', async () => {
            h.define('locked', {
                handler: async () => {
                    const run = getCurrentTaskRun() as any
                    expect(() => { run.status = 'failed' }).toThrow()
                    expect(() => { run.name = 'other' }).toThrow()
                    return {}
                },
            })
            await h.fire('locked')
            await h.flush()
            expect(finishEvents(h)[0].status).toBe('succeeded')
        })
    })

    describe('status registry', () => {
        it('reports a task as running only while its run is open', async () => {
            const gate = deferred()
            h.define('long', { handler: async () => { await gate.promise; return {} } })

            const run = h.fire('long')
            await new Promise(resolve => setTimeout(resolve, 1))

            expect(isTaskRunning('long')).toBe(true)
            expect(isTaskRunning('other')).toBe(false)
            const [open] = getRunningTasks()
            expect(open.status).toBe('running')
            expect(open.finishedAt).toBeNull()

            gate.resolve()
            await run
            expect(isTaskRunning('long')).toBe(false)
            expect(getRunningTasks()).toEqual([])
        })

        it('closes a run that failed', async () => {
            h.define('dies', { handler: async () => { throw new Error('x') } })
            await h.fire('dies').catch(() => {})
            expect(isTaskRunning('dies')).toBe(false)
        })
    })
})

describe('hook snapshots', () => {
    afterEach(() => {
        resetTaskRuntime()
        moduleConfiguration.setModuleOptions(DEFAULT_MODULE_OPTIONS)
    })

    it('record meta as it was at the event, including nested values', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
        const h = createHarness('native')
        h.define('lines', {
            options: { maxRetries: 1, retryDelay: 1 },
            handler: async () => {
                const run = getCurrentTaskRun()!
                const lines = (run.meta.lines as string[] | undefined) ?? []
                lines.push(`attempt ${run.attempt}`)
                run.meta.lines = lines
                if (run.attempt === 1) throw new Error('retry me')
                return {}
            },
        })

        await h.fire('lines')
        await h.flush()
        errorSpy.mockRestore()

        const failed = h.events.find(e => e.hook === 'task:run:attempt-failed')!.event
        expect(failed.run.meta).toEqual({ lines: ['attempt 1'] })
        expect(finishEvents(h)[0].run.meta).toEqual({ lines: ['attempt 1', 'attempt 2'] })
    })

    it('fall back to a shallow copy for values that cannot be cloned', async () => {
        const h = createHarness('native')
        const fn = () => 1
        h.define('fn', {
            handler: async () => {
                getCurrentTaskRun()!.meta.callback = fn
                return {}
            },
        })

        await h.fire('fn')
        await h.flush()
        expect(finishEvents(h)[0].run.meta.callback).toBe(fn)
    })
})
