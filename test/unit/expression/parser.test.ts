import { describe, it, expect } from 'vitest'
import CronExpressionUtils from '../../../src/runtime/utils/expression/parser'
import { CronExpressionParseError } from '../../../src/runtime/types/expression'




describe('cron parser', () => {
    describe('validate values', () => {
        it('validates minutes correctly', () => {
            expect(CronExpressionUtils.validateValue('minute', 0)).toBe(true)
            expect(CronExpressionUtils.validateValue('minute', 59)).toBe(true)
            expect(CronExpressionUtils.validateValue('minute', -1)).toBe(false)
            expect(CronExpressionUtils.validateValue('minute', 60)).toBe(false)
        })

        it('validates hours correctly', () => {
            expect(CronExpressionUtils.validateValue('hour', 0)).toBe(true)
            expect(CronExpressionUtils.validateValue('hour', 23)).toBe(true)
            expect(CronExpressionUtils.validateValue('hour', -1)).toBe(false)
            expect(CronExpressionUtils.validateValue('hour', 24)).toBe(false)
        })

        it('rejects decimal values', () => {
            expect(CronExpressionUtils.validateValue('minute', 1.5)).toBe(false)
            expect(CronExpressionUtils.validateValue('hour', 12.3)).toBe(false)
            expect(CronExpressionUtils.validateValue('month', 6.7)).toBe(false)
        })

        it('handles special number formats correctly', () => {
            expect(CronExpressionUtils.validateValue('minute', Number('00'))).toBe(true) // Leading zeros
            expect(CronExpressionUtils.validateValue('hour', +'12')).toBe(true) // Unary plus
            expect(CronExpressionUtils.validateValue('month', Number(''))).toBe(false) // Empty string conversion
        })

        it('validates edge cases for all fields', () => {
            // Minutes
            expect(CronExpressionUtils.validateValue('minute', 0)).toBe(true) // Lower bound
            expect(CronExpressionUtils.validateValue('minute', 59)).toBe(true) // Upper bound
            expect(CronExpressionUtils.validateValue('minute', -0)).toBe(true) // Negative zero
            expect(CronExpressionUtils.validateValue('minute', 59.0)).toBe(true) // Decimal point zero

            // Hours
            expect(CronExpressionUtils.validateValue('hour', 0)).toBe(true) // Lower bound
            expect(CronExpressionUtils.validateValue('hour', 23)).toBe(true) // Upper bound
            expect(CronExpressionUtils.validateValue('hour', -0)).toBe(true) // Negative zero
            expect(CronExpressionUtils.validateValue('hour', 23.0)).toBe(true) // Decimal point zero

            // Day of Month
            expect(CronExpressionUtils.validateValue('dayOfMonth', 1)).toBe(true) // Lower bound
            expect(CronExpressionUtils.validateValue('dayOfMonth', 31)).toBe(true) // Upper bound
            expect(CronExpressionUtils.validateValue('dayOfMonth', 0)).toBe(false) // Invalid lower
            expect(CronExpressionUtils.validateValue('dayOfMonth', 32)).toBe(false) // Invalid upper

            // Month
            expect(CronExpressionUtils.validateValue('month', 1)).toBe(true) // Lower bound
            expect(CronExpressionUtils.validateValue('month', 12)).toBe(true) // Upper bound
            expect(CronExpressionUtils.validateValue('month', 0)).toBe(false) // Invalid lower
            expect(CronExpressionUtils.validateValue('month', 13)).toBe(false) // Invalid upper

            // Day of Week
            expect(CronExpressionUtils.validateValue('dayOfWeek', 0)).toBe(true) // Sunday
            expect(CronExpressionUtils.validateValue('dayOfWeek', 6)).toBe(true) // Saturday
            expect(CronExpressionUtils.validateValue('dayOfWeek', 7)).toBe(false) // Invalid day
            expect(CronExpressionUtils.validateValue('dayOfWeek', -1)).toBe(false) // Invalid negative
        })
    })

    describe('parsing fields', () => {
        describe('asterisk patterns', () => {
            it('handles asterisk with various whitespace', () => {
                expect(CronExpressionUtils.parseField('minute', ' * ')).toEqual(Array.from({ length: 60 }, (_, i) => i))
                expect(CronExpressionUtils.parseField('minute', '*')).toEqual(Array.from({ length: 60 }, (_, i) => i))
                expect(CronExpressionUtils.parseField('minute', '  *  ')).toEqual(Array.from({ length: 60 }, (_, i) => i))
            })
        })

        describe('list patterns', () => {
            it('handles lists with various spacing', () => {
                expect(CronExpressionUtils.parseField('minute', '1,2,3')).toEqual([1, 2, 3])
                expect(CronExpressionUtils.parseField('minute', '1, 2, 3')).toEqual([1, 2, 3])
                expect(CronExpressionUtils.parseField('minute', '1,  2,  3')).toEqual([1, 2, 3])
            })

            it('handles lists with ranges', () => {
                expect(CronExpressionUtils.parseField('minute', '1-3,5-7')).toEqual([1, 2, 3, 5, 6, 7])
                expect(CronExpressionUtils.parseField('minute', '1,2,5-7')).toEqual([1, 2, 5, 6, 7])
            })

            it('handles lists with steps', () => {
                expect(CronExpressionUtils.parseField('minute', '*/15,0-10/2')).toEqual([0, 2, 4, 6, 8, 10, 15, 30, 45])
            })

            it('throws error for invalid list items', () => {
                expect(() => CronExpressionUtils.parseField('minute', '1,2,60')).toThrow(CronExpressionParseError)
                expect(() => CronExpressionUtils.parseField('minute', '1,invalid,3')).toThrow(CronExpressionParseError)
                expect(() => CronExpressionUtils.parseField('minute', '1,,3')).toThrow(CronExpressionParseError)
            })

            it('deduplicates overlapping values in lists', () => {
                expect(CronExpressionUtils.parseField('minute', '1-5,3-7')).toEqual([1, 2, 3, 4, 5, 6, 7])
                expect(CronExpressionUtils.parseField('hour', '0,0,0')).toEqual([0])
            })

            it('handles long lists of values', () => {
                const longList = Array.from({ length: 30 }, (_, i) => i).join(',')
                expect(() => CronExpressionUtils.parseField('minute', longList)).not.toThrow()
            })
        })

        describe('range patterns', () => {
            it('handles various range formats', () => {
                expect(CronExpressionUtils.parseField('minute', '1-5')).toEqual([1, 2, 3, 4, 5])
                expect(CronExpressionUtils.parseField('minute', ' 1-5 ')).toEqual([1, 2, 3, 4, 5])
                expect(CronExpressionUtils.parseField('minute', '1 - 5')).toEqual([1, 2, 3, 4, 5])
            })

            it('handles single-number ranges', () => {
                expect(CronExpressionUtils.parseField('minute', '5-5')).toEqual([5])
            })

            it('throws error for invalid ranges', () => {
                expect(() => CronExpressionUtils.parseField('minute', '5-1')).toThrow(CronExpressionParseError)
                expect(() => CronExpressionUtils.parseField('minute', '1-60')).toThrow(CronExpressionParseError)
                expect(() => CronExpressionUtils.parseField('minute', '-1-5')).toThrow(CronExpressionParseError)
                expect(() => CronExpressionUtils.parseField('minute', '1-')).toThrow(CronExpressionParseError)
                expect(() => CronExpressionUtils.parseField('minute', '-')).toThrow(CronExpressionParseError)
            })
        })

        describe('step patterns', () => {
            it('handles various step patterns', () => {
                expect(CronExpressionUtils.parseField('minute', '*/15')).toEqual([0, 15, 30, 45])
                expect(CronExpressionUtils.parseField('minute', '0-30/10')).toEqual([0, 10, 20, 30])
                expect(CronExpressionUtils.parseField('minute', '5-20/5')).toEqual([5, 10, 15, 20])
            })

            it('handles steps with ranges', () => {
                expect(CronExpressionUtils.parseField('minute', '10-20/2')).toEqual([10, 12, 14, 16, 18, 20])
            })

            it('throws error for invalid steps', () => {
                expect(() => CronExpressionUtils.parseField('minute', '*/0')).toThrow(CronExpressionParseError)
                expect(() => CronExpressionUtils.parseField('minute', '*/60')).toThrow(CronExpressionParseError)
                expect(() => CronExpressionUtils.parseField('minute', '/2')).toThrow(CronExpressionParseError)
                expect(() => CronExpressionUtils.parseField('minute', '1-10/')).toThrow(CronExpressionParseError)
                expect(() => CronExpressionUtils.parseField('minute', '1-10/0')).toThrow(CronExpressionParseError)
                expect(() => CronExpressionUtils.parseField('minute', '1-10/-1')).toThrow(CronExpressionParseError)
            })

            it('handles steps with single values', () => {
                expect(CronExpressionUtils.parseField('minute', '5/15')).toEqual([5, 20, 35, 50])
            })

            it('throws error for steps that exceed the field range', () => {
                expect(() => CronExpressionUtils.parseField('hour', '*/25')).toThrow(CronExpressionParseError)
                expect(() => CronExpressionUtils.parseField('minute', '*/70')).toThrow(CronExpressionParseError)
                expect(() => CronExpressionUtils.parseField('month', '*/13')).toThrow(CronExpressionParseError)
                expect(() => CronExpressionUtils.parseField('dayOfWeek', '*/8')).toThrow(CronExpressionParseError)
            })

            it('handles various whitespace in step patterns', () => {
                expect(CronExpressionUtils.parseField('minute', '*/15')).toEqual(CronExpressionUtils.parseField('minute', '* / 15'))
                expect(CronExpressionUtils.parseField('minute', '0-10/2')).toEqual(CronExpressionUtils.parseField('minute', '0 - 10 / 2'))
            })
        })
    })

    describe('expression parsing', () => {
        it('parses full cron expressions correctly', () => {
            const result = CronExpressionUtils.parseCronExpression('* * * * *')
            expect(result.minute).toHaveLength(60)
            expect(result.hour).toHaveLength(24)
            expect(result.dayOfMonth).toHaveLength(31)
            expect(result.month).toHaveLength(12)
            expect(result.dayOfWeek).toHaveLength(7)
        })

        it('handles various spacing in expressions', () => {
            const normal = CronExpressionUtils.parseCronExpression('* * * * *')
            const extraSpace = CronExpressionUtils.parseCronExpression('*  *  *  *  *')
            const tabSpace = CronExpressionUtils.parseCronExpression('*\t*\t*\t*\t*')
            expect(normal).toEqual(extraSpace)
            expect(normal).toEqual(tabSpace)
        })

        it('handles complex combinations correctly', () => {
            const result = CronExpressionUtils.parseCronExpression('*/15,5-10 0,12 1-15/2 */2 1-5')
            expect(result.minute).toEqual([0, 5, 6, 7, 8, 9, 10, 15, 30, 45])
            expect(result.hour).toEqual([0, 12])
            expect(result.dayOfMonth).toEqual([1, 3, 5, 7, 9, 11, 13, 15])
            expect(result.month).toEqual([2, 4, 6, 8, 10, 12])
            expect(result.dayOfWeek).toEqual([1, 2, 3, 4, 5])
        })

        it('parses specific cron expressions correctly', () => {
            const result = CronExpressionUtils.parseCronExpression('*/15 0 1,15 * 1-5')
            expect(result.minute).toEqual([0, 15, 30, 45])
            expect(result.hour).toEqual([0])
            expect(result.dayOfMonth).toEqual([1, 15])
            expect(result.month).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
            expect(result.dayOfWeek).toEqual([1, 2, 3, 4, 5])
        })

        it('handles various unicode whitespace characters', () => {
            const result1 = CronExpressionUtils.parseCronExpression('*\u2002*\u2003*\u2004*\u2005*')
            const result2 = CronExpressionUtils.parseCronExpression('* * * * *')
            expect(result1).toEqual(result2)
        })

        it('handles edge cases with large ranges and steps', () => {
            expect(() => CronExpressionUtils.parseCronExpression('0-59/1 0-23/1 1-31/1 1-12/1 0-6/1')).not.toThrow()
        })

        it('throws error for various invalid expressions', () => {
            // Invalid number of fields
            expect(() => CronExpressionUtils.parseCronExpression('')).toThrow(CronExpressionParseError)
            expect(() => CronExpressionUtils.parseCronExpression('* * * *')).toThrow(CronExpressionParseError)
            expect(() => CronExpressionUtils.parseCronExpression('* * * * * *')).toThrow(CronExpressionParseError)

            // Invalid field values
            expect(() => CronExpressionUtils.parseCronExpression('60 * * * *')).toThrow(CronExpressionParseError)
            expect(() => CronExpressionUtils.parseCronExpression('* 24 * * *')).toThrow(CronExpressionParseError)
            expect(() => CronExpressionUtils.parseCronExpression('* * 32 * *')).toThrow(CronExpressionParseError)
            expect(() => CronExpressionUtils.parseCronExpression('* * * 13 *')).toThrow(CronExpressionParseError)
            expect(() => CronExpressionUtils.parseCronExpression('* * * * 7')).toThrow(CronExpressionParseError)

            // Invalid characters
            expect(() => CronExpressionUtils.parseCronExpression('a * * * *')).toThrow(CronExpressionParseError)
            expect(() => CronExpressionUtils.parseCronExpression('* b * * *')).toThrow(CronExpressionParseError)
            expect(() => CronExpressionUtils.parseCronExpression('* * c * *')).toThrow(CronExpressionParseError)
            expect(() => CronExpressionUtils.parseCronExpression('* * * d *')).toThrow(CronExpressionParseError)
            expect(() => CronExpressionUtils.parseCronExpression('* * * * e')).toThrow(CronExpressionParseError)
        })

        it('handles edge cases in each field', () => {
            // All fields at minimum values
            expect(() => CronExpressionUtils.parseCronExpression('0 0 1 1 0')).not.toThrow()

            // All fields at maximum values
            expect(() => CronExpressionUtils.parseCronExpression('59 23 31 12 6')).not.toThrow()

            // Complex ranges and steps in each field
            expect(() => CronExpressionUtils.parseCronExpression('0-59/15 0-23/2 1-31/5 1-12/3 0-6/2')).not.toThrow()

            // Mixed patterns in each field
            const result = CronExpressionUtils.parseCronExpression('0,15,30-45/5 0,12-23/3 1,15-31/5 */2 1-5')
            expect(result.minute).toBeDefined()
            expect(result.hour).toBeDefined()
            expect(result.dayOfMonth).toBeDefined()
            expect(result.month).toBeDefined()
            expect(result.dayOfWeek).toBeDefined()
        })
    })

    describe('error handling', () => {
        it('provides descriptive error messages', () => {
            try {
                CronExpressionUtils.parseField('minute', '60')
            }
            catch (error) {
                expect(error instanceof CronExpressionParseError).toBe(true)
                const cronParseError = error as CronExpressionParseError

                expect(cronParseError.message).toContain('Value out of range')
                expect(cronParseError.field).toBe('minute')
                expect(cronParseError.value).toBe('60')
            }
        })

        it('detects malformed expressions', () => {
            expect(() => CronExpressionUtils.parseCronExpression('** * * * *')).toThrow(CronExpressionParseError)
            expect(() => CronExpressionUtils.parseCronExpression('*/*/* * * * *')).toThrow(CronExpressionParseError)
            expect(() => CronExpressionUtils.parseCronExpression('1--2 * * * *')).toThrow(CronExpressionParseError)
        })
    })

    describe('month and day handling', () => {
        it('handles month-specific patterns correctly', () => {
            expect(CronExpressionUtils.parseField('month', '*/2')).toEqual([2, 4, 6, 8, 10, 12])
            expect(CronExpressionUtils.parseField('month', '2-12/3')).toEqual([2, 5, 8, 11])
        })

        it('handles day of week patterns correctly', () => {
            expect(CronExpressionUtils.parseField('dayOfWeek', '*/2')).toEqual([0, 2, 4, 6])
            expect(CronExpressionUtils.parseField('dayOfWeek', '1-5')).toEqual([1, 2, 3, 4, 5]) // Monday to Friday
        })
    })
})
