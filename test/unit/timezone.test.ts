import { describe, it, expect } from 'vitest'
import { DateTime } from 'luxon'

import TimezoneUtils from '../../src/runtime/utils/timezone'

describe('TimezoneUtils', () => {
  describe('convertTimezone', () => {
    it('should correctly convert between timezones using Date object', () => {
      const date = new Date('2024-01-30T15:00:00Z') // 15:00 UTC
                        const result = TimezoneUtils.convertTimezone(
        date,
        "UTC",
        "America/New_York",
        "HH:mm"
      );
      expect(result).toBe('10:00') // 15:00 UTC = 10:00 EST
                })

                it('should correctly convert between timezones using ISO string', () => {
      const result = TimezoneUtils.convertTimezone(
        "2024-01-30T15:00:00Z",
        "UTC",
        "Asia/Tokyo",
        "HH:mm"
      );
      expect(result).toBe('00:00') // Next day in Tokyo
                })

                it('should handle DST transitions correctly', () => {
      // March 10, 2024, 1:59 AM EST -> 3:00 AM EDT (spring forward)
      const beforeDST = TimezoneUtils.convertTimezone(
        "2024-03-10T06:59:00Z", // 1:59 AM EST
        "UTC",
        "America/New_York",
        "HH:mm"
      );
      expect(beforeDST).toBe('01:59')

                        const afterDST = TimezoneUtils.convertTimezone(
        "2024-03-10T07:00:00Z", // 3:00 AM EDT
        "UTC",
        "America/New_York",
        "HH:mm"
      );
      expect(afterDST).toBe('03:00')
                })

                it('should throw error for invalid date input', () => {
      expect(() => {
        TimezoneUtils.convertTimezone(
          {} as any,
          'UTC',
          'America/New_York',
                                );
      }).toThrow('Invalid date format')
                })
        })

        describe('fromLocal', () => {
    it('should convert local time to target timezone', () => {
      const localDate = new Date('2024-01-30T10:00:00') // Local time
                        const result = TimezoneUtils.fromLocal(
        localDate,
        "Asia/Tokyo",
        "yyyy-MM-dd HH:mm"
      );

      // Get expected time by creating a DateTime directly in Tokyo timezone
      const expected
                = DateTime.fromJSDate(localDate).setZone('Asia/Tokyo')
                        expect(result).toBe(expected.toFormat('yyyy-MM-dd HH:mm'))
                })
        })

        describe('toLocal', () => {
    it('should convert timezone time to local time', () => {
      const date = new Date('2024-01-30T15:00:00Z')
                        const result = TimezoneUtils.toLocal(
        date,
        "Asia/Tokyo"
      ) as DateTime

                        expect(result.isValid).toBe(true)
                        expect(result.zoneName).toBe(DateTime.local().zoneName)
                })
        })

        describe('isInDST', () => {
    it('should correctly identify DST status', () => {
      // This test assumes running in a timezone that observes DST
      const summerDate = TimezoneUtils.isInDST('America/New_York')
                        expect(typeof summerDate).toBe('boolean')
                })
        })

        describe('getTimezoneOffset', () => {
    it('should return correct timezone offset', () => {
      const offset = TimezoneUtils.getTimezoneOffset('America/New_York')
                        expect(offset).toMatch(/^[+-]\d{2}:\d{2}$/)
                })

                it('should handle specific date for offset', () => {
      // Testing summer time (EDT)
      const summerOffset = TimezoneUtils.getTimezoneOffset(
        "America/New_York",
        new Date('2024-07-01T12:00:00Z'),
                        );
      expect(summerOffset).toBe('-04:00')

                        // Testing winter time (EST)
                        const winterOffset = TimezoneUtils.getTimezoneOffset(
        "America/New_York",
        new Date('2024-01-01T12:00:00Z'),
                        );
      expect(winterOffset).toBe('-05:00')
                })
        })

        describe('isValidTimezone', () => {
    it('should validate correct timezone strings', () => {
      expect(TimezoneUtils.isValidTimezone('America/New_York')).toBe(
        true
      );
      expect(TimezoneUtils.isValidTimezone('Asia/Tokyo')).toBe(true)
                        expect(TimezoneUtils.isValidTimezone('Europe/London')).toBe(true)
                })

                it('should invalidate incorrect timezone strings', () => {
      expect(TimezoneUtils.isValidTimezone('Invalid/Timezone')).toBe(
        false
      );
      expect(TimezoneUtils.isValidTimezone('GMT+2')).toBe(false)
                        expect(TimezoneUtils.isValidTimezone('')).toBe(false)
                })
        })
})
