import { describe, it, expect } from 'vitest'
import CronExpressionUtils from '../../../src/runtime/expression/parser'
import { CronExpressionParseError } from '../../../src/runtime/expression/types'

/**
 * The field parser accepted several things a cron expression cannot contain,
 * and quietly changed the meaning of one thing it did accept.
 *
 * These only affect custom-scheduler mode; native mode is scheduled by croner.
 */
describe('cron field parsing strictness', () => {
    describe('numeric literals', () => {
        it('rejects hexadecimal values', () => {
            // Number('0x10') is 16, which is a legal minute, so this parsed.
            expect(() => CronExpressionUtils.parseField('minute', '0x10'))
                .toThrow(CronExpressionParseError)
        })

        it('rejects exponential notation', () => {
            expect(() => CronExpressionUtils.parseField('minute', '1e1'))
                .toThrow(CronExpressionParseError)
        })

        it('rejects decimals', () => {
            expect(() => CronExpressionUtils.parseField('minute', '5.5'))
                .toThrow(CronExpressionParseError)
        })

        it('rejects values with surrounding whitespace inside a list', () => {
            expect(() => CronExpressionUtils.parseField('minute', '0x1,5'))
                .toThrow(CronExpressionParseError)
        })

        it('still accepts ordinary integers', () => {
            expect(CronExpressionUtils.parseField('minute', '5')).toEqual([5])
        })

        it('still accepts zero-padded integers', () => {
            expect(CronExpressionUtils.parseField('minute', '05')).toEqual([5])
        })
    })

    describe('step expressions', () => {
        it('rejects a step with more than one separator', () => {
            // This used to silently parse as "5/10", dropping the third part.
            expect(() => CronExpressionUtils.parseField('minute', '5/10/20'))
                .toThrow(CronExpressionParseError)
        })

        it('rejects a hexadecimal step', () => {
            expect(() => CronExpressionUtils.parseField('minute', '*/0x2'))
                .toThrow(CronExpressionParseError)
        })

        it('still accepts an ordinary step', () => {
            expect(CronExpressionUtils.parseField('minute', '*/15'))
                .toEqual([0, 15, 30, 45])
        })

        it('still accepts a step from a starting value', () => {
            expect(CronExpressionUtils.parseField('minute', '5/10'))
                .toEqual([5, 15, 25, 35, 45, 55])
        })
    })

    describe('month steps start at January', () => {
        // Every month step used to start at 2, so `*/1` — which means "every
        // month" — silently excluded January.
        it('includes every month for */1', () => {
            expect(CronExpressionUtils.parseField('month', '*/1'))
                .toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
        })

        it('starts at January for */2', () => {
            expect(CronExpressionUtils.parseField('month', '*/2'))
                .toEqual([1, 3, 5, 7, 9, 11])
        })

        it('starts at January for */3', () => {
            expect(CronExpressionUtils.parseField('month', '*/3'))
                .toEqual([1, 4, 7, 10])
        })

        it('still honours an explicit range start', () => {
            expect(CronExpressionUtils.parseField('month', '2-12/3'))
                .toEqual([2, 5, 8, 11])
        })

        it('matches a bare asterisk', () => {
            expect(CronExpressionUtils.parseField('month', '*/1'))
                .toEqual(CronExpressionUtils.parseField('month', '*'))
        })
    })
})
