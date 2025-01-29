import { describe, it, expect } from 'vitest'
import {
    parseField,
    parseCronExpression,
    CronParseError,
    validateValue
} from '../../../src/runtime/utils/expression'



describe('cron parser', () => {
    describe('validateValue', () => {
        it('validates minutes correctly', () => {
            expect(validateValue('minute', 0)).toBe(true)
            expect(validateValue('minute', 59)).toBe(true)
            expect(validateValue('minute', -1)).toBe(false)
            expect(validateValue('minute', 60)).toBe(false)
        })

        it('validates hours correctly', () => {
            expect(validateValue('hour', 0)).toBe(true)
            expect(validateValue('hour', 23)).toBe(true)
            expect(validateValue('hour', -1)).toBe(false)
            expect(validateValue('hour', 24)).toBe(false)
        })

        it('rejects decimal values', () => {
            expect(validateValue('minute', 1.5)).toBe(false)
            expect(validateValue('hour', 12.3)).toBe(false)
            expect(validateValue('month', 6.7)).toBe(false)
        })

        it('handles special number formats correctly', () => {
            expect(validateValue('minute', Number('00'))).toBe(true)    // Leading zeros
            expect(validateValue('hour', +'12')).toBe(true)             // Unary plus
            expect(validateValue('month', Number(''))).toBe(false)      // Empty string conversion
        })

        it('validates edge cases for all fields', () => {
            // Minutes
            expect(validateValue('minute', 0)).toBe(true)               // Lower bound
            expect(validateValue('minute', 59)).toBe(true)              // Upper bound
            expect(validateValue('minute', -0)).toBe(true)              // Negative zero
            expect(validateValue('minute', 59.0)).toBe(true)            // Decimal point zero

            // Hours
            expect(validateValue('hour', 0)).toBe(true)                 // Lower bound
            expect(validateValue('hour', 23)).toBe(true)                // Upper bound
            expect(validateValue('hour', -0)).toBe(true)                // Negative zero
            expect(validateValue('hour', 23.0)).toBe(true)              // Decimal point zero

            // Day of Month
            expect(validateValue('dayOfMonth', 1)).toBe(true)           // Lower bound
            expect(validateValue('dayOfMonth', 31)).toBe(true)          // Upper bound
            expect(validateValue('dayOfMonth', 0)).toBe(false)          // Invalid lower
            expect(validateValue('dayOfMonth', 32)).toBe(false)         // Invalid upper

            // Month
            expect(validateValue('month', 1)).toBe(true)                // Lower bound
            expect(validateValue('month', 12)).toBe(true)               // Upper bound
            expect(validateValue('month', 0)).toBe(false)               // Invalid lower
            expect(validateValue('month', 13)).toBe(false)              // Invalid upper

            // Day of Week
            expect(validateValue('dayOfWeek', 0)).toBe(true)            // Sunday
            expect(validateValue('dayOfWeek', 6)).toBe(true)            // Saturday
            expect(validateValue('dayOfWeek', 7)).toBe(false)           // Invalid day
            expect(validateValue('dayOfWeek', -1)).toBe(false)          // Invalid negative
        })
    })

    describe('parseField', () => {
        describe('asterisk patterns', () => {
            it('handles asterisk with various whitespace', () => {
                expect(parseField('minute', ' * ')).toEqual(Array.from({ length: 60 }, (_, i) => i))
                expect(parseField('minute', '*')).toEqual(Array.from({ length: 60 }, (_, i) => i))
                expect(parseField('minute', '  *  ')).toEqual(Array.from({ length: 60 }, (_, i) => i))
            })
        })

        describe('list patterns', () => {
            it('handles lists with various spacing', () => {
                expect(parseField('minute', '1,2,3')).toEqual([1, 2, 3])
                expect(parseField('minute', '1, 2, 3')).toEqual([1, 2, 3])
                expect(parseField('minute', '1,  2,  3')).toEqual([1, 2, 3])
            })

            it('handles lists with ranges', () => {
                expect(parseField('minute', '1-3,5-7')).toEqual([1, 2, 3, 5, 6, 7])
                expect(parseField('minute', '1,2,5-7')).toEqual([1, 2, 5, 6, 7])
            })

            it('handles lists with steps', () => {
                expect(parseField('minute', '*/15,0-10/2')).toEqual([0, 2, 4, 6, 8, 10, 15, 30, 45])
            })

            it('throws error for invalid list items', () => {
                expect(() => parseField('minute', '1,2,60')).toThrow(CronParseError)
                expect(() => parseField('minute', '1,invalid,3')).toThrow(CronParseError)
                expect(() => parseField('minute', '1,,3')).toThrow(CronParseError)
            })

            it('deduplicates overlapping values in lists', () => {
                expect(parseField('minute', '1-5,3-7')).toEqual([1, 2, 3, 4, 5, 6, 7])
                expect(parseField('hour', '0,0,0')).toEqual([0])
            })

            it('handles long lists of values', () => {
                const longList = Array.from({ length: 30 }, (_, i) => i).join(',')
                expect(() => parseField('minute', longList)).not.toThrow()
            })
        })

        describe('range patterns', () => {
            it('handles various range formats', () => {
                expect(parseField('minute', '1-5')).toEqual([1, 2, 3, 4, 5])
                expect(parseField('minute', ' 1-5 ')).toEqual([1, 2, 3, 4, 5])
                expect(parseField('minute', '1 - 5')).toEqual([1, 2, 3, 4, 5])
            })

            it('handles single-number ranges', () => {
                expect(parseField('minute', '5-5')).toEqual([5])
            })

            it('throws error for invalid ranges', () => {
                expect(() => parseField('minute', '5-1')).toThrow(CronParseError)
                expect(() => parseField('minute', '1-60')).toThrow(CronParseError)
                expect(() => parseField('minute', '-1-5')).toThrow(CronParseError)
                expect(() => parseField('minute', '1-')).toThrow(CronParseError)
                expect(() => parseField('minute', '-')).toThrow(CronParseError)
            })
        })

        describe('step patterns', () => {
            it('handles various step patterns', () => {
                expect(parseField('minute', '*/15')).toEqual([0, 15, 30, 45])
                expect(parseField('minute', '0-30/10')).toEqual([0, 10, 20, 30])
                expect(parseField('minute', '5-20/5')).toEqual([5, 10, 15, 20])
            })

            it('handles steps with ranges', () => {
                expect(parseField('minute', '10-20/2')).toEqual([10, 12, 14, 16, 18, 20])
            })

            it('throws error for invalid steps', () => {
                expect(() => parseField('minute', '*/0')).toThrow(CronParseError)
                expect(() => parseField('minute', '*/60')).toThrow(CronParseError)
                expect(() => parseField('minute', '/2')).toThrow(CronParseError)
                expect(() => parseField('minute', '1-10/')).toThrow(CronParseError)
                expect(() => parseField('minute', '1-10/0')).toThrow(CronParseError)
                expect(() => parseField('minute', '1-10/-1')).toThrow(CronParseError)
            })

            it('handles steps with single values', () => {
                expect(parseField('minute', '5/15')).toEqual([5, 20, 35, 50])
            })

            it('throws error for steps that exceed the field range', () => {
                expect(() => parseField('hour', '*/25')).toThrow(CronParseError)
                expect(() => parseField('minute', '*/70')).toThrow(CronParseError)
                expect(() => parseField('month', '*/13')).toThrow(CronParseError)
                expect(() => parseField('dayOfWeek', '*/8')).toThrow(CronParseError)
            })

            it('handles various whitespace in step patterns', () => {
                expect(parseField('minute', '*/15')).toEqual(parseField('minute', '* / 15'))
                expect(parseField('minute', '0-10/2')).toEqual(parseField('minute', '0 - 10 / 2'))
            })
        })
    })

    describe('parseCronExpression', () => {
        it('parses full cron expressions correctly', () => {
            const result = parseCronExpression('* * * * *')
            expect(result.minute).toHaveLength(60)
            expect(result.hour).toHaveLength(24)
            expect(result.dayOfMonth).toHaveLength(31)
            expect(result.month).toHaveLength(12)
            expect(result.dayOfWeek).toHaveLength(7)
        })

        it('handles various spacing in expressions', () => {
            const normal = parseCronExpression('* * * * *')
            const extraSpace = parseCronExpression('*  *  *  *  *')
            const tabSpace = parseCronExpression('*\t*\t*\t*\t*')
            expect(normal).toEqual(extraSpace)
            expect(normal).toEqual(tabSpace)
        })

        it('handles complex combinations correctly', () => {
            const result = parseCronExpression('*/15,5-10 0,12 1-15/2 */2 1-5')
            expect(result.minute).toEqual([0, 5, 6, 7, 8, 9, 10, 15, 30, 45])
            expect(result.hour).toEqual([0, 12])
            expect(result.dayOfMonth).toEqual([1, 3, 5, 7, 9, 11, 13, 15])
            expect(result.month).toEqual([2, 4, 6, 8, 10, 12])
            expect(result.dayOfWeek).toEqual([1, 2, 3, 4, 5])
        })

        it('parses specific cron expressions correctly', () => {
            const result = parseCronExpression('*/15 0 1,15 * 1-5')
            expect(result.minute).toEqual([0, 15, 30, 45])
            expect(result.hour).toEqual([0])
            expect(result.dayOfMonth).toEqual([1, 15])
            expect(result.month).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
            expect(result.dayOfWeek).toEqual([1, 2, 3, 4, 5])
        })

        it('handles various unicode whitespace characters', () => {
            const result1 = parseCronExpression('*\u2002*\u2003*\u2004*\u2005*')
            const result2 = parseCronExpression('* * * * *')
            expect(result1).toEqual(result2)
        })

        it('handles edge cases with large ranges and steps', () => {
            expect(() => parseCronExpression('0-59/1 0-23/1 1-31/1 1-12/1 0-6/1')).not.toThrow()
        })

        it('throws error for various invalid expressions', () => {
            // Invalid number of fields
            expect(() => parseCronExpression('')).toThrow(CronParseError)
            expect(() => parseCronExpression('* * * *')).toThrow(CronParseError)
            expect(() => parseCronExpression('* * * * * *')).toThrow(CronParseError)

            // Invalid field values
            expect(() => parseCronExpression('60 * * * *')).toThrow(CronParseError)
            expect(() => parseCronExpression('* 24 * * *')).toThrow(CronParseError)
            expect(() => parseCronExpression('* * 32 * *')).toThrow(CronParseError)
            expect(() => parseCronExpression('* * * 13 *')).toThrow(CronParseError)
            expect(() => parseCronExpression('* * * * 7')).toThrow(CronParseError)

            // Invalid characters
            expect(() => parseCronExpression('a * * * *')).toThrow(CronParseError)
            expect(() => parseCronExpression('* b * * *')).toThrow(CronParseError)
            expect(() => parseCronExpression('* * c * *')).toThrow(CronParseError)
            expect(() => parseCronExpression('* * * d *')).toThrow(CronParseError)
            expect(() => parseCronExpression('* * * * e')).toThrow(CronParseError)
        })

        it('handles edge cases in each field', () => {
            // All fields at minimum values
            expect(() => parseCronExpression('0 0 1 1 0')).not.toThrow()

            // All fields at maximum values
            expect(() => parseCronExpression('59 23 31 12 6')).not.toThrow()

            // Complex ranges and steps in each field
            expect(() => parseCronExpression('0-59/15 0-23/2 1-31/5 1-12/3 0-6/2')).not.toThrow()

            // Mixed patterns in each field
            const result = parseCronExpression('0,15,30-45/5 0,12-23/3 1,15-31/5 */2 1-5')
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
                parseField('minute', '60')
            } catch (error) {
                expect(error instanceof CronParseError).toBe(true)
                const cronParseError = error as CronParseError

                expect(cronParseError.message).toContain('Value out of range')
                expect(cronParseError.field).toBe('minute')
                expect(cronParseError.value).toBe('60')
            }
        })

        it('detects malformed expressions', () => {
            expect(() => parseCronExpression('** * * * *')).toThrow(CronParseError)
            expect(() => parseCronExpression('*/*/* * * * *')).toThrow(CronParseError)
            expect(() => parseCronExpression('1--2 * * * *')).toThrow(CronParseError)
        })
    })

    describe('month and day handling', () => {
        it('handles month-specific patterns correctly', () => {
            expect(parseField('month', '*/2')).toEqual([2, 4, 6, 8, 10, 12])
            expect(parseField('month', '2-12/3')).toEqual([2, 5, 8, 11])
        })

        it('handles day of week patterns correctly', () => {
            expect(parseField('dayOfWeek', '*/2')).toEqual([0, 2, 4, 6])
            expect(parseField('dayOfWeek', '1-5')).toEqual([1, 2, 3, 4, 5])  // Monday to Friday
        })
    })
});