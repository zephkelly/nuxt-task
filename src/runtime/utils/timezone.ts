import { DateTime } from 'luxon'

import type { ModuleOptions } from './../../module'

export interface FlexibleTimezoneOptions {
    type: string
    validate: boolean
    strict: false // explicitly false
}

export interface StrictTimezoneOptions {
    type: string
    validate: boolean
    strict: true
}

type DateFormatOptions = string | null
type DateInput = Date | string

export class TimezoneUtils {
    /**
     * Helper to validate if a DateTime is valid and throw if not
     * @internal
     */
    private static validateDateTime(dt: DateTime, errorMessage: string): void {
        if (!dt.isValid) {
            throw new Error(errorMessage)
        }
    }

    /**
 * Convert a date from one timezone to another
 * @param {DateInput} date - The date to convert
 * @param {string} fromTimezone - The source timezone (e.g., 'America/New_York')
 * @param {string} toTimezone - The target timezone (e.g., 'Asia/Tokyo')
 * @param {DateFormatOptions} format - Optional format string for the output
 * @returns {DateTime | string} - Luxon DateTime object or formatted string in the target timezone
 */
    static convertTimezone(
        date: DateInput,
        fromTimezone: string,
        toTimezone: string,
        format: DateFormatOptions = null,
    ): DateTime | string {
        let dateTime: DateTime

        if (date instanceof Date) {
            dateTime = DateTime.fromJSDate(date)
        } else if (typeof date === 'string') {
            dateTime = DateTime.fromISO(date)
        } else {
            throw new TypeError(
                "Invalid date format. Please provide a Date object or ISO string."
            )
        }

        const converted: DateTime = dateTime
            .setZone(fromTimezone)
            .setZone(toTimezone)

        this.validateDateTime(converted, 'Invalid timezone conversion result')

        return format ? converted.toFormat(format) : converted
    }

    /**
 * Convert local system time to a target timezone
 * @param {DateInput} localDate - The local date to convert
 * @param {string} targetTimezone - The target timezone
 * @param {DateFormatOptions} format - Optional format string for the output
 * @returns {DateTime | string} - Luxon DateTime object or formatted string in the target timezone
 */
    static fromLocal(
        localDate: DateInput,
        targetTimezone: string,
        format: DateFormatOptions = null,
    ): DateTime | string {
        let dateTime: DateTime

        if (localDate instanceof Date) {
            dateTime = DateTime.fromJSDate(localDate)
        } else if (typeof localDate === 'string') {
            dateTime = DateTime.fromISO(localDate)
        } else {
            throw new TypeError(
                "Invalid date format. Please provide a Date object or ISO string."
            )
        }

        const converted: DateTime = dateTime.setZone(targetTimezone)

        this.validateDateTime(converted, 'Invalid timezone conversion result')

        return format ? converted.toFormat(format) : converted
    }

    /**
 * Convert a timezone-specific time to local system time
 * @param {DateInput} date - The date to convert
 * @param {string} sourceTimezone - The source timezone
 * @param {DateFormatOptions} format - Optional format string for the output
 * @returns {DateTime | string} - Luxon DateTime object or formatted string in local system timezone
 */
    static toLocal(
        date: DateInput,
        sourceTimezone: string,
        format: DateFormatOptions = null,
    ): DateTime | string {
        let dateTime: DateTime

        if (date instanceof Date) {
            dateTime = DateTime.fromJSDate(date)
        } else if (typeof date === 'string') {
            dateTime = DateTime.fromISO(date)
        } else {
            throw new TypeError(
                "Invalid date format. Please provide a Date object or ISO string."
            )
        }

        const converted: DateTime = dateTime.setZone(sourceTimezone).toLocal()

        this.validateDateTime(converted, 'Invalid timezone conversion result')

        return format ? converted.toFormat(format) : converted
    }

    /**
 * Convert a DateTime object or string to a JavaScript Date object
 * @param {DateTime | string} date - The date to convert
 * @returns {Date} - JavaScript Date object
 */
    static toJSDate(date: DateTime | string): Date {
        if (typeof date === 'string') {
            return DateTime.fromISO(date).toJSDate()
        }
        return date.toJSDate()
    }

    /**
 * Check if a given timezone is currently in DST
 * @param {string} timezone - The timezone to check
 * @returns {boolean} - True if the timezone is currently in DST
 */
    static isInDST(timezone: string): boolean {
        const now: DateTime = DateTime.now().setZone(timezone)
        return now.isInDST
    }

    /**
 * Get the UTC offset for a timezone at a specific date
 * @param {string} timezone - The timezone to check
 * @param {DateInput} [date] - Optional date to check offset for (defaults to current time)
 * @returns {string} - The UTC offset in the format '+HH:mm' or '-HH:mm'
 */
    static getTimezoneOffset(
        timezone: string,
        date: DateInput | null = null,
    ): string {
        const dateTime: DateTime = date
            ? (TimezoneUtils.convertTimezone(date, 'UTC', timezone) as DateTime)
            : DateTime.now().setZone(timezone)

        return dateTime.toFormat('ZZ')
    }

    /**
 * Validate if a timezone string is valid
 * @param {string} timezone - The timezone to validate
 * @returns {boolean} - True if the timezone is valid
 */
    static isValidTimezone(
        timezone: StrictTimezoneOptions | FlexibleTimezoneOptions | string,
    ): boolean {
        if (
            !timezone
            || (typeof timezone !== 'string' && typeof timezone !== 'object')
            || Array.isArray(timezone) // Add this check
        ) {
            return false
        }

        if (typeof timezone === 'string') {
            return this.isValidTimezoneString(timezone)
        }

        return this.isValidTimezoneOptions(timezone)
    }

    /**
 * Validate if a timezone string is valid
 * @param {string} timezone - The timezone to validate
 * @returns {boolean} - True if the timezone is valid
 * @internal For internal use only
 * @see isValidTimezonens
 */
    private static isValidTimezoneOptions(
        timezone: StrictTimezoneOptions | FlexibleTimezoneOptions,
    ): boolean {
        try {
            const dt = DateTime.now().setZone(timezone.type)
            return dt.isValid
        }
        catch (e) {
            console.log('Error validating timezone', e)
            return false
        }
    }

    /**
 * Validate if a timezone string is valid
 * @param {string} timezoneString - The timezone to validate
 * @returns {boolean} - True if the timezone is valid
 * @internal For internal use only
 * @see isValidTimezone
 */
    private static isValidTimezoneString(timezoneString: string): boolean {
        return DateTime.now().setZone(timezoneString).isValid
    }

    /**
 * Validate if a timezone string matches the flexible timezone configuration
 * @param {string} timezone - The timezone to validate
 * @returns {boolean} - True if the timezone matches the module's flexible configuration
 */
    static isStrictTimezoneModuleOptions(options: ModuleOptions): boolean {
        if (!options.timezone) {
            return false
        }

        return options.timezone.strict === true
    }

    /**
 * Validate if a timezone string matches the flexible timezone configuration
 * @param {string} timezone - The timezone to validate
 * @returns {boolean} - True if the timezone matches the module's flexible configuration
 */
    static isFlexibleTimezoneModuleOptions(options: ModuleOptions): boolean {
        if (!options.timezone) {
            return false
        }

        return options.timezone.strict === false
    }
}

export default TimezoneUtils
