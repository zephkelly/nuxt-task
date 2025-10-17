// test/unit/utils/timezone.test.ts - Add these additional tests

import { describe, it, expect, vi } from 'vitest'
import { DateTime } from 'luxon'
import TimezoneUtils from '../../../src/runtime/utils/timezone'

describe('TimezoneUtils', () => {
    describe('convertTimezone - error cases', () => {
        it('should throw TypeError for invalid date type', () => {
            expect(() => {
                TimezoneUtils.convertTimezone(
                    123 as any, // Invalid type
                    'UTC',
                    'America/New_York'
                )
            }).toThrow('Invalid date format. Please provide a Date object or ISO string.')
        })

        it('should throw TypeError for null date', () => {
            expect(() => {
                TimezoneUtils.convertTimezone(
                    null as any,
                    'UTC',
                    'America/New_York'
                )
            }).toThrow('Invalid date format. Please provide a Date object or ISO string.')
        })

        it('should throw TypeError for undefined date', () => {
            expect(() => {
                TimezoneUtils.convertTimezone(
                    undefined as any,
                    'UTC',
                    'America/New_York'
                )
            }).toThrow('Invalid date format. Please provide a Date object or ISO string.')
        })

        it('should throw TypeError for object date', () => {
            expect(() => {
                TimezoneUtils.convertTimezone(
                    {} as any,
                    'UTC',
                    'America/New_York'
                )
            }).toThrow('Invalid date format. Please provide a Date object or ISO string.')
        })

        it('should throw TypeError for array date', () => {
            expect(() => {
                TimezoneUtils.convertTimezone(
                    [] as any,
                    'UTC',
                    'America/New_York'
                )
            }).toThrow('Invalid date format. Please provide a Date object or ISO string.')
        })
    })

    describe('fromLocal - error cases', () => {
        it('should throw TypeError for invalid date type', () => {
            expect(() => {
                TimezoneUtils.fromLocal(
                    123 as any,
                    'America/New_York'
                )
            }).toThrow('Invalid date format. Please provide a Date object or ISO string.')
        })

        it('should throw TypeError for null date', () => {
            expect(() => {
                TimezoneUtils.fromLocal(
                    null as any,
                    'America/New_York'
                )
            }).toThrow('Invalid date format. Please provide a Date object or ISO string.')
        })

        it('should throw TypeError for object date', () => {
            expect(() => {
                TimezoneUtils.fromLocal(
                    { year: 2024 } as any,
                    'America/New_York'
                )
            }).toThrow('Invalid date format. Please provide a Date object or ISO string.')
        })

        it('should throw error for invalid timezone in fromLocal', () => {
            expect(() => {
                TimezoneUtils.fromLocal(
                    new Date('2024-01-30T15:00:00Z'),
                    'Invalid/Timezone'
                )
            }).toThrow('Invalid timezone conversion result')
        })
    })

    describe('toLocal - error cases', () => {
        it('should throw TypeError for invalid date type', () => {
            expect(() => {
                TimezoneUtils.toLocal(
                    123 as any,
                    'America/New_York'
                )
            }).toThrow('Invalid date format. Please provide a Date object or ISO string.')
        })

        it('should throw TypeError for null date', () => {
            expect(() => {
                TimezoneUtils.toLocal(
                    null as any,
                    'America/New_York'
                )
            }).toThrow('Invalid date format. Please provide a Date object or ISO string.')
        })

        it('should throw TypeError for boolean date', () => {
            expect(() => {
                TimezoneUtils.toLocal(
                    true as any,
                    'America/New_York'
                )
            }).toThrow('Invalid date format. Please provide a Date object or ISO string.')
        })

        it('should throw error for invalid timezone in toLocal', () => {
            expect(() => {
                TimezoneUtils.toLocal(
                    new Date('2024-01-30T15:00:00Z'),
                    'BadTimezone/Invalid'
                )
            }).toThrow('Invalid timezone conversion result')
        })
    })

    describe('toJSDate - edge cases', () => {
        it('should handle invalid ISO string', () => {
            const result = TimezoneUtils.toJSDate('invalid-date-string')
            expect(result).toBeInstanceOf(Date)
            // Invalid ISO strings create invalid dates
            expect(isNaN(result.getTime())).toBe(true)
        })

        it('should handle empty string', () => {
            const result = TimezoneUtils.toJSDate('')
            expect(result).toBeInstanceOf(Date)
        })

        it('should handle valid DateTime object', () => {
            const dateTime = DateTime.fromISO('2024-01-30T15:00:00Z')
            const result = TimezoneUtils.toJSDate(dateTime)

            expect(result).toBeInstanceOf(Date)
            expect(result.toISOString()).toBe('2024-01-30T15:00:00.000Z')
        })
    })

    describe('isValidTimezoneOptions - catch block coverage', () => {
        it('should catch and handle errors during validation', () => {
            const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => { })

            // Create an options object that might throw during validation
            const invalidOptions = {
                type: 'Invalid/Zone',
                validate: true,
                strict: false as const,
            }

            const result = TimezoneUtils.isValidTimezone(invalidOptions)

            expect(result).toBe(false)

            consoleLogSpy.mockRestore()
        })

        it('should handle timezone options with special characters', () => {
            const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => { })

            const invalidOptions = {
                type: 'America/New@York!',
                validate: true,
                strict: false as const,
            }

            const result = TimezoneUtils.isValidTimezone(invalidOptions)

            expect(result).toBe(false)

            consoleLogSpy.mockRestore()
        })

        it('should handle timezone options with empty type', () => {
            const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => { })

            const invalidOptions = {
                type: '',
                validate: true,
                strict: false as const,
            }

            const result = TimezoneUtils.isValidTimezone(invalidOptions)

            expect(result).toBe(false)

            consoleLogSpy.mockRestore()
        })
    })

    describe('getTimezoneOffset - with invalid dates', () => {
        it('should handle null date and return current offset', () => {
            const offset = TimezoneUtils.getTimezoneOffset('America/New_York', null)
            expect(offset).toMatch(/^[+-]\d{2}:\d{2}$/)
        })

        it('should handle string date input', () => {
            const offset = TimezoneUtils.getTimezoneOffset(
                'Europe/London',
                '2024-07-01T12:00:00Z'
            )
            expect(offset).toBe('+01:00')
        })

        it('should handle Date object input', () => {
            const offset = TimezoneUtils.getTimezoneOffset(
                'Asia/Tokyo',
                new Date('2024-01-15T00:00:00Z')
            )
            expect(offset).toBe('+09:00')
        })
    })

    describe('isValidTimezoneString - comprehensive tests', () => {
        it('should validate common timezones', () => {
            expect(TimezoneUtils.isValidTimezone('UTC')).toBe(true)
            expect(TimezoneUtils.isValidTimezone('America/New_York')).toBe(true)
            expect(TimezoneUtils.isValidTimezone('Europe/London')).toBe(true)
            expect(TimezoneUtils.isValidTimezone('Asia/Tokyo')).toBe(true)
            expect(TimezoneUtils.isValidTimezone('Australia/Sydney')).toBe(true)
        })

        it('should invalidate malformed timezone strings', () => {
            expect(TimezoneUtils.isValidTimezone('NotATimezone')).toBe(false)
            expect(TimezoneUtils.isValidTimezone('America/')).toBe(false)
            expect(TimezoneUtils.isValidTimezone('/NewYork')).toBe(false)
            expect(TimezoneUtils.isValidTimezone('GMT+5')).toBe(false)
        })

        it('should handle empty string', () => {
            expect(TimezoneUtils.isValidTimezone('')).toBe(false)
        })
    })

    describe('Edge cases for all conversion methods', () => {
        it('should handle convertTimezone with formatted output', () => {
            const result = TimezoneUtils.convertTimezone(
                '2024-06-15T12:00:00Z',
                'UTC',
                'America/Los_Angeles',
                'yyyy-MM-dd HH:mm:ss'
            )

            expect(typeof result).toBe('string')
            expect(result).toContain('2024-06-15')
        })

        it('should handle fromLocal with formatted output', () => {
            const result = TimezoneUtils.fromLocal(
                new Date('2024-06-15T12:00:00'),
                'Europe/Paris',
                'yyyy-MM-dd'
            )

            expect(typeof result).toBe('string')
            expect(result).toContain('2024')
        })

        it('should handle toLocal with formatted output', () => {
            const result = TimezoneUtils.toLocal(
                '2024-06-15T12:00:00Z',
                'Asia/Shanghai',
                'HH:mm:ss'
            )

            expect(typeof result).toBe('string')
            expect(result).toMatch(/^\d{2}:\d{2}:\d{2}$/)
        })
    })

    describe('isInDST - comprehensive coverage', () => {
        it('should check DST for various timezones', () => {
            const nyDST = TimezoneUtils.isInDST('America/New_York')
            expect(typeof nyDST).toBe('boolean')

            const tokyoDST = TimezoneUtils.isInDST('Asia/Tokyo')
            expect(tokyoDST).toBe(false) // Japan doesn't observe DST

            const londonDST = TimezoneUtils.isInDST('Europe/London')
            expect(typeof londonDST).toBe('boolean')
        })

        it('should return false for UTC', () => {
            const utcDST = TimezoneUtils.isInDST('UTC')
            expect(utcDST).toBe(false)
        })
    })

    describe('convertTimezone - invalid conversion results', () => {
        it('should throw error when conversion produces invalid DateTime', () => {
            // This creates an invalid DateTime by using a bad timezone
            expect(() => {
                TimezoneUtils.convertTimezone(
                    new Date('2024-01-30T15:00:00Z'),
                    'Invalid/Zone',
                    'America/New_York'
                )
            }).toThrow('Invalid timezone conversion result')
        })

        it('should throw error when target timezone is invalid', () => {
            expect(() => {
                TimezoneUtils.convertTimezone(
                    new Date('2024-01-30T15:00:00Z'),
                    'UTC',
                    'NotReal/Zone'
                )
            }).toThrow('Invalid timezone conversion result')
        })

        it('should throw error for both invalid timezones', () => {
            expect(() => {
                TimezoneUtils.convertTimezone(
                    '2024-01-30T15:00:00Z',
                    'Bad/Zone',
                    'Also/Bad'
                )
            }).toThrow('Invalid timezone conversion result')
        })
    })

    describe('fromLocal - invalid conversion results', () => {
        it('should throw error when target timezone is invalid', () => {
            expect(() => {
                TimezoneUtils.fromLocal(
                    new Date('2024-01-30T15:00:00Z'),
                    'Invalid/Timezone'
                )
            }).toThrow('Invalid timezone conversion result')
        })

        it('should throw error with string date and invalid timezone', () => {
            expect(() => {
                TimezoneUtils.fromLocal(
                    '2024-01-30T15:00:00Z',
                    'Bad/Timezone'
                )
            }).toThrow('Invalid timezone conversion result')
        })
    })

    describe('isValidTimezone - type checking edge cases', () => {
        it('should return false for boolean', () => {
            expect(TimezoneUtils.isValidTimezone(false as any)).toBe(false)
        })

        it('should return false for array', () => {
            expect(TimezoneUtils.isValidTimezone([] as any)).toBe(false)
        })

        it('should return false for function', () => {
            expect(TimezoneUtils.isValidTimezone((() => { }) as any)).toBe(false)
        })

        it('should return false for symbol', () => {
            expect(TimezoneUtils.isValidTimezone(Symbol('test') as any)).toBe(false)
        })
    })

    describe('Module options validation - ensuring coverage', () => {
        it('should validate isStrictTimezoneModuleOptions with strict=true', () => {
            const options = {
                timezone: {
                    type: 'UTC',
                    validate: true,
                    strict: true as const,
                },
                serverTasks: true,
                clientTasks: false,
                experimental: { tasks: false },
                storage: { type: 'memory' as const },
            }

            expect(TimezoneUtils.isStrictTimezoneModuleOptions(options)).toBe(true)
        })

        it('should validate isStrictTimezoneModuleOptions with strict=false', () => {
            const options = {
                timezone: {
                    type: 'UTC',
                    validate: true,
                    strict: false as const,
                },
                serverTasks: true,
                clientTasks: false,
                experimental: { tasks: false },
                storage: { type: 'memory' as const },
            }

            expect(TimezoneUtils.isStrictTimezoneModuleOptions(options)).toBe(false)
        })

        it('should validate isFlexibleTimezoneModuleOptions with strict=false', () => {
            const options = {
                timezone: {
                    type: 'America/New_York',
                    validate: true,
                    strict: false as const,
                },
                serverTasks: true,
                clientTasks: false,
                experimental: { tasks: false },
                storage: { type: 'memory' as const },
            }

            expect(TimezoneUtils.isFlexibleTimezoneModuleOptions(options)).toBe(true)
        })

        it('should validate isFlexibleTimezoneModuleOptions with strict=true', () => {
            const options = {
                timezone: {
                    type: 'Europe/London',
                    validate: true,
                    strict: true as const,
                },
                serverTasks: true,
                clientTasks: false,
                experimental: { tasks: false },
                storage: { type: 'memory' as const },
            }

            expect(TimezoneUtils.isFlexibleTimezoneModuleOptions(options)).toBe(false)
        })

        it('should handle missing timezone in module options for strict check', () => {
            const options = {
                serverTasks: true,
                clientTasks: false,
                experimental: { tasks: false },
                storage: { type: 'memory' as const },
            } as any

            expect(TimezoneUtils.isStrictTimezoneModuleOptions(options)).toBe(false)
        })

        it('should handle missing timezone in module options for flexible check', () => {
            const options = {
                serverTasks: true,
                clientTasks: false,
                experimental: { tasks: false },
                storage: { type: 'memory' as const },
            } as any

            expect(TimezoneUtils.isFlexibleTimezoneModuleOptions(options)).toBe(false)
        })
    })
})