import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Cron } from 'croner'

import { nextRun, cronerPreviousRun, isScheduleParked } from '../../../src/runtime/server/runs/schedule'
import { TaskNotFoundError } from '../../../src/runtime/server/runs/errors'
import { attachTaskRuntime, resetTaskRuntime } from '../../../src/runtime/server/runs/state'
import { moduleConfiguration, DEFAULT_MODULE_OPTIONS } from '../../../src/runtime/config'
import type { TaskInfo } from '../../../src/runtime/server/runs/types'
import { createHarness, finishEvents, moduleOptionsFor, type Mode } from './helpers'

function croner(expression: string, from: Date, timezone?: string): Date | null {
    const cron = new Cron(expression, { paused: true, ...(timezone ? { timezone } : {}) })
    try {
        return cron.nextRun(from)
    }
    finally {
        cron.stop()
    }
}

function task(name: string, schedule: string | undefined, extra: Partial<TaskInfo> = {}): TaskInfo {
    return { name, metaName: name, description: undefined, schedule, options: {}, parked: false, ...extra }
}

// Expressions both grammars read the same way (no day-of-month AND
// day-of-week combination, no month steps), at the month, year and leap-day
// edges.
const EDGE_CASES: Array<[string, string]> = [
    ['0 0 1 * *', '2026-01-31T23:59:30.000Z'],
    ['0 0 1 * *', '2026-02-28T12:00:00.000Z'],
    ['59 23 31 12 *', '2026-12-31T23:58:00.000Z'],
    ['0 0 1 1 *', '2026-12-31T23:59:59.000Z'],
    ['0 0 29 2 *', '2027-03-01T00:00:00.000Z'],
    ['0 0 29 2 *', '2028-02-28T23:59:00.000Z'],
    ['0 12 29 2 *', '2028-02-29T11:59:00.000Z'],
    ['0 0 31 * *', '2026-04-15T00:00:00.000Z'],
    ['*/15 * * * *', '2026-03-31T23:50:00.000Z'],
    ['30 2 * * 1', '2026-12-30T00:00:00.000Z'],
    ['0 0 * 2 *', '2026-02-28T23:59:00.000Z'],
]

describe('nextRun', () => {
    let originalTz: string | undefined

    beforeEach(() => {
        originalTz = process.env.TZ
    })

    afterEach(() => {
        if (originalTz === undefined) delete process.env.TZ
        else process.env.TZ = originalTz
        resetTaskRuntime()
        moduleConfiguration.setModuleOptions(DEFAULT_MODULE_OPTIONS)
    })

    describe('custom mode agrees with croner (UTC)', () => {
        beforeEach(() => {
            moduleConfiguration.setModuleOptions(moduleOptionsFor('custom'))
            attachTaskRuntime({ mode: 'custom', registry: [] })
        })

        it.each(EDGE_CASES)('%s after %s', (expression, from) => {
            const expected = croner(expression, new Date(from), 'UTC')
            expect(nextRun(expression, new Date(from))).toEqual(expected)
        })

        it('honours a task timezone in flexible mode', () => {
            attachTaskRuntime({
                registry: [task('syd', '0 9 * * *', { options: { timezone: 'Australia/Sydney' } })],
            })
            const from = new Date('2026-06-01T00:00:00.000Z')
            expect(nextRun('syd', from)).toEqual(croner('0 9 * * *', from, 'Australia/Sydney'))
        })

        it('forces the module timezone in strict mode', () => {
            moduleConfiguration.setModuleOptions(moduleOptionsFor('custom', {
                timezone: { type: 'America/New_York', strict: true, validate: true },
            }))
            attachTaskRuntime({
                registry: [task('ny', '0 9 * * *', { options: { timezone: 'Australia/Sydney' } })],
            })
            const from = new Date('2026-06-01T00:00:00.000Z')
            expect(nextRun('ny', from)).toEqual(croner('0 9 * * *', from, 'America/New_York'))
        })
    })

    describe('native mode follows croner in the process zone', () => {
        beforeEach(() => {
            moduleConfiguration.setModuleOptions(moduleOptionsFor('native', {
                timezone: { type: 'America/New_York', strict: false, validate: true },
            }))
        })

        it.each(EDGE_CASES)('%s after %s', (expression, from) => {
            attachTaskRuntime({ mode: 'native', registry: [task('t', expression)] })
            expect(nextRun('t', new Date(from))).toEqual(croner(expression, new Date(from)))
        })

        it('ignores nuxtTask.timezone and the task timezone, as Nitro does', () => {
            process.env.TZ = 'Australia/Sydney'
            attachTaskRuntime({
                mode: 'native',
                registry: [task('t', '0 9 * * *', { options: { timezone: 'Europe/London' } })],
            })
            const from = new Date('2026-06-01T00:00:00.000Z')

            // 09:00 Sydney (AEST, UTC+10) on 1 June is 23:00 UTC on 1 June.
            expect(nextRun('t', from)).toEqual(new Date('2026-06-01T23:00:00.000Z'))
        })

        it('accepts croner-only syntax', () => {
            attachTaskRuntime({ mode: 'native', registry: [] })
            const from = new Date('2026-06-01T00:00:00.000Z')
            expect(nextRun('@daily', from)).toEqual(croner('@daily', from))
            expect(nextRun('0 0 * * 7', from)).toEqual(croner('0 0 * * 7', from))
        })
    })

    describe.each<Mode>(['native', 'custom'])('in %s mode', (mode) => {
        beforeEach(() => {
            moduleConfiguration.setModuleOptions(moduleOptionsFor(mode))
            attachTaskRuntime({
                mode,
                registry: [
                    task('parked', '0 0 30 2 *', { parked: true }),
                    task('feb30', '0 0 30 2 *'),
                    task('manual-only', undefined),
                ],
            })
        })

        it('returns null for a parked task', () => {
            expect(nextRun('parked')).toBeNull()
        })

        it('returns null for a schedule that can never fire, even if not flagged', () => {
            expect(nextRun('feb30')).toBeNull()
            expect(nextRun('0 0 30 2 *')).toBeNull()
        })

        it('returns null for an on-demand task', () => {
            expect(nextRun('manual-only')).toBeNull()
        })

        it('throws TaskNotFoundError for an unknown name', () => {
            expect(() => nextRun('no:such-task')).toThrow(TaskNotFoundError)
        })

        it('throws for an invalid expression', () => {
            expect(() => nextRun('61 * * * *')).toThrow()
        })

        it('defaults from to now', () => {
            const result = nextRun('*/5 * * * *')!
            expect(result.getTime()).toBeGreaterThan(Date.now())
            expect(result.getTime() - Date.now()).toBeLessThanOrEqual(5 * 60_000)
        })
    })
})

describe('isScheduleParked', () => {
    it('flags never-firing schedules in both modes', () => {
        expect(isScheduleParked('0 0 30 2 *', 'native')).toBe(true)
        expect(isScheduleParked('0 0 30 2 *', 'custom', 'UTC', moduleOptionsFor('custom'))).toBe(true)
        expect(isScheduleParked('0 0 29 2 *', 'native')).toBe(false)
        expect(isScheduleParked('0 0 29 2 *', 'custom', 'UTC', moduleOptionsFor('custom'))).toBe(false)
    })

    it('follows each mode\'s day matching rules', () => {
        // croner ORs day-of-month and day-of-week, so this fires on Mondays;
        // the custom scheduler ANDs them, so it never fires.
        expect(isScheduleParked('0 0 30 2 1', 'native')).toBe(false)
        expect(isScheduleParked('0 0 30 2 1', 'custom', 'UTC', moduleOptionsFor('custom'))).toBe(true)
    })

    it('is false for missing or invalid schedules', () => {
        expect(isScheduleParked(undefined, 'native')).toBe(false)
        expect(isScheduleParked('not a cron', 'native')).toBe(false)
        expect(isScheduleParked('not a cron', 'custom')).toBe(false)
    })
})

describe('cronerPreviousRun', () => {
    it('returns the latest occurrence at or before now', () => {
        const now = new Date('2026-03-01T10:22:31.000Z')
        expect(cronerPreviousRun('*/15 * * * *', now)).toEqual(new Date('2026-03-01T10:15:00.000Z'))
    })

    it('includes an occurrence exactly at now, and one a timer fired a hair early for', () => {
        const tick = new Date('2026-03-01T10:15:00.000Z')
        expect(cronerPreviousRun('*/15 * * * *', tick)).toEqual(tick)
        expect(cronerPreviousRun('*/15 * * * *', new Date(tick.getTime() - 2))).toEqual(tick)
    })

    it('widens its search for sparse schedules', () => {
        process.env.TZ = 'UTC'
        try {
            expect(cronerPreviousRun('0 0 29 2 *', new Date('2027-06-01T00:00:00.000Z')))
                .toEqual(new Date('2024-02-29T00:00:00.000Z'))
        }
        finally {
            delete process.env.TZ
        }
    })

    it('returns null for a schedule that never fires', () => {
        expect(cronerPreviousRun('0 0 30 2 *', new Date())).toBeNull()
    })
})

describe('scheduledFor', () => {
    let errorSpy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
        errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    })

    afterEach(() => {
        vi.useRealTimers()
        errorSpy.mockRestore()
        resetTaskRuntime()
        moduleConfiguration.setModuleOptions(DEFAULT_MODULE_OPTIONS)
    })

    describe('native mode', () => {
        it('is the tick a scheduled fire belongs to, not Nitro\'s boot-time payload', async () => {
            const h = createHarness('native')
            h.define('quarter', { schedule: '*/15 * * * *', handler: async () => ({}) })

            // Nitro's runner fires a little after the tick, with a payload
            // whose scheduledTime is the boot time.
            vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-03-01T10:15:00.180Z') })
            await h.fire('quarter', { payload: { scheduledTime: Date.parse('2026-03-01T08:00:00Z') } })
            await h.flush()

            const run = finishEvents(h)[0].run
            expect(run.trigger).toBe('schedule')
            expect(run.scheduledFor).toEqual(new Date('2026-03-01T10:15:00.000Z'))
        })

        it('handles a timer that fires a millisecond early', async () => {
            const h = createHarness('native')
            h.define('quarter', { schedule: '*/15 * * * *', handler: async () => ({}) })

            vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-03-01T10:14:59.999Z') })
            await h.fire('quarter')
            await h.flush()

            expect(finishEvents(h)[0].run.scheduledFor).toEqual(new Date('2026-03-01T10:15:00.000Z'))
        })

        it('uses the process zone, like Nitro\'s croner', async () => {
            const originalTz = process.env.TZ
            process.env.TZ = 'Australia/Sydney'
            try {
                const h = createHarness('native')
                h.define('morning', { schedule: '0 9 * * *', handler: async () => ({}) })

                // 09:00:02 AEST on 2 June is 23:00:02 UTC on 1 June.
                vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-06-01T23:00:02.000Z') })
                await h.fire('morning')
                await h.flush()

                expect(finishEvents(h)[0].run.scheduledFor).toEqual(new Date('2026-06-01T23:00:00.000Z'))
            }
            finally {
                if (originalTz === undefined) delete process.env.TZ
                else process.env.TZ = originalTz
            }
        })

        it('is null for a manual run', async () => {
            const { triggerTask } = await import('../../../src/runtime/server/runs/trigger')
            const h = createHarness('native')
            h.define('quarter', { schedule: '*/15 * * * *', handler: async () => ({}) })

            await triggerTask('quarter')
            await h.flush()

            expect(finishEvents(h)[0].run).toMatchObject({ trigger: 'manual', scheduledFor: null })
        })

        it('treats a direct run of an on-demand task as manual', async () => {
            const h = createHarness('native')
            h.define('on-demand', { schedule: '', handler: async () => ({}) })

            await h.fire('on-demand')
            await h.flush()

            expect(finishEvents(h)[0].run).toMatchObject({ trigger: 'manual', scheduledFor: null })
        })
    })

    describe('custom mode', () => {
        it('is the occurrence the custom scheduler says is due', async () => {
            const h = createHarness('custom')
            h.define('quarter', { schedule: '*/15 * * * *', handler: async () => ({}) })

            const due = new Date('2026-03-01T10:15:00.000Z')
            await h.fire('quarter', { scheduledFor: due })
            await h.flush()

            expect(finishEvents(h)[0].run).toMatchObject({ trigger: 'schedule', scheduledFor: due })
        })
    })
})
