import { type FlexibleTimezoneOptions, type StrictTimezoneOptions } from './../utils/timezone'



export const CRON_RANGES = {
    minute: { min: 0, max: 59 },
    hour: { min: 0, max: 23 },
    dayOfMonth: { min: 1, max: 31 },
    month: { min: 1, max: 12 },
    dayOfWeek: { min: 0, max: 6 }, // 0 = Sunday
} as const

export type CronExpressionField = keyof typeof CRON_RANGES


export class CronExpressionParseError extends Error {
    constructor(
        message: string,
        public field?: CronExpressionField,
        public value?: string,
    ) {
        super(message)
        this.name = 'CronParseError'
    }
}

interface ExpressionValidationOptions {
    allowSecondsField?: boolean
    allowYearField?: boolean
    allowAliases?: boolean
    requireDayConstraint?: boolean
    useStandardFormat?: boolean
}

export interface CronExpressionOptions {
    expression?: {
        validation?: ExpressionValidationOptions,
    },

    timezone?: FlexibleTimezoneOptions | StrictTimezoneOptions,
    validateTimezone?: boolean
}

export interface ParsedExpression {
    minute: number[]
    hour: number[]
    dayOfMonth: number[]
    month: number[]
    dayOfWeek: number[]
    timezone: string
}



export type CronPresets =
    'everyMinute' |
    'everyFiveMinutes' |
    'everyTenMinutes' |
    'everyFifteenMinutes' |
    'everyThirtyMinutes' |
    'hourly' |
    'daily' |
    'weekly' |
    'monthly' |
    'yearly'

export const cronPresets: Record<CronPresets, string> = {
    everyMinute: '* * * * *',
    everyFiveMinutes: '*/5 * * * *',
    everyTenMinutes: '*/10 * * * *',
    everyFifteenMinutes: '*/15 * * * *',
    everyThirtyMinutes: '*/30 * * * *',
    hourly: '0 * * * *',
    daily: '0 0 * * *',
    weekly: '0 0 * * 0',
    monthly: '0 0 1 * *',
    yearly: '0 0 1 1 *'
}