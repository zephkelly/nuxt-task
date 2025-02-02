import { DateTime } from 'luxon'

import { getModuleOptions } from './../config'



export interface FlexibleTimezoneOptions {
    type: string
    validate: boolean
    strict: false // explicitly false
}
  
export interface StrictTimezoneOptions {
    type: string
    validate: boolean
    strict: true // explicitly true
}

type DateFormatOptions = string | null
type DateInput = Date | string


class TimezoneUtils {
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
        }
        else if (typeof date === 'string') {
            dateTime = DateTime.fromISO(date)
        }
        else {
            throw new TypeError('Invalid date format. Please provide a Date object or ISO string.')
        }

        const converted: DateTime = dateTime.setZone(fromTimezone).setZone(toTimezone)

        if (!converted.isValid) {
            throw new Error('Invalid timezone conversion result')
        }

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
        }
        else if (typeof localDate === 'string') {
            dateTime = DateTime.fromISO(localDate)
        }
        else {
            throw new TypeError('Invalid date format. Please provide a Date object or ISO string.')
        }

        const converted: DateTime = dateTime.setZone(targetTimezone)

        if (!converted.isValid) {
            throw new Error('Invalid timezone conversion result')
        }

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
        }
        else if (typeof date === 'string') {
            dateTime = DateTime.fromISO(date)
        }
        else {
            throw new TypeError('Invalid date format. Please provide a Date object or ISO string.')
        }

        const converted: DateTime = dateTime.setZone(sourceTimezone).toLocal()

        if (!converted.isValid) {
            throw new Error('Invalid timezone conversion result')
        }

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
    static getTimezoneOffset(timezone: string, date: DateInput | null = null): string {
        const dateTime: DateTime = date
            ? TimezoneUtils.convertTimezone(date, 'UTC', timezone) as DateTime
            : DateTime.now().setZone(timezone)

        return dateTime.toFormat('ZZ')
    }

    /**
     * Validate if a timezone string is valid
     * @param {string} timezone - The timezone to validate
     * @returns {boolean} - True if the timezone is valid
     */
    static isValidTimezone(timezone: string): boolean {
        if (!timezone || typeof timezone !== 'string') {
            return false
        }

        try {
            const dt = DateTime.now().setZone(timezone)
            return dt.isValid
        }
        catch (e) {
            return false
        }
    }

    /**
     * Validate if a timezone string matches the strict timezone configuration
     * @param {string} timezone - The timezone to validate
     * @returns {boolean} - True if the timezone matches the module's strict configuration
     */
    static isValidStrictTimezone(timezone: string): boolean {
        if (!TimezoneUtils.isValidTimezone(timezone)) {
            return false
        }

        const moduleOptions = getModuleOptions()
        if (!moduleOptions.timezone.strict) {
            return true
        }

        // For strict mode, ensure the timezone matches the configured timezone exactly
        return moduleOptions.timezone.type === timezone
    }
}

export default TimezoneUtils