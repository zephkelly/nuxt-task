import TimezoneUtils from '../utils/timezone'

import {
    CRON_RANGES,
    type CronExpressionField,
    type CronExpressionOptions,
    type ParsedExpression,
    CronExpressionParseError,
} from './types'
import type { ModuleOptions } from 'nuxt/schema'

import { moduleConfiguration } from '../config'



type ParseFieldResult = number[]
type RangeDefinition = { min: number, max: number }

export class CronExpressionParser {
    public parseCronExpression(
        expression: string,
        options: CronExpressionOptions = {},
        moduleOptions: ModuleOptions = moduleConfiguration.getModuleOptions()
    ): ParsedExpression {
        if (!moduleOptions) {
            throw new Error('Module options not found')
        }

        const timezone = options.timezone ?? moduleOptions.timezone

        const shouldValidateTimezone = timezone.validate ?? moduleOptions.timezone.validate
        const isStrictMode = timezone.strict ?? moduleOptions.timezone.strict

        if (shouldValidateTimezone) {
            if (isStrictMode && !TimezoneUtils.isValidTimezone(timezone)) {
                throw new CronExpressionParseError(
                    `Invalid timezone: ${timezone.type}. Strict mode requires a valid IANA timezone identifier.`
                )
            } else if (!TimezoneUtils.isValidTimezone(timezone.type)) {
                throw new CronExpressionParseError(
                    `Invalid timezone: ${timezone.type}. Please use a valid timezone identifier.`
                )
            }
        }

        const fields = expression.trim().split(/\s+/)

        if (fields.length !== 5) {
            throw new CronExpressionParseError(
                `Invalid number of fields: expected 5, got ${fields.length}`
            )
        }

        try {
            return {
                minute: this.parseField('minute', fields[0]),
                hour: this.parseField('hour', fields[1]),
                dayOfMonth: this.parseField('dayOfMonth', fields[2]),
                month: this.parseField('month', fields[3]),
                dayOfWeek: this.parseField('dayOfWeek', fields[4]),
                timezone: timezone.type
            }
        } catch (error) {
            if (error instanceof CronExpressionParseError) {
                throw error
            }
            throw new CronExpressionParseError('Failed to parse cron expression')
        }
    }

    public validateValue(field: CronExpressionField, value: number): boolean {
        if (!Number.isInteger(value)) {
            return false
        }

        const range = CRON_RANGES[field]
        return value >= range.min && value <= range.max
    }

    private createSequence(min: number, max: number): number[] {
        return Array.from({ length: max - min + 1 }, (_, i) => min + i)
    }

    private parseNumericValue(field: CronExpressionField, value: string, context: string): number {
        const num = Number(value)
        if (isNaN(num)) {
            throw new CronExpressionParseError('Invalid number format', field, context)
        }
        if (!this.validateValue(field, num)) {
            throw new CronExpressionParseError('Value out of range', field, context)
        }
        return num
    }

    private handleAsterisk(range: RangeDefinition): ParseFieldResult {
        return this.createSequence(range.min, range.max)
    }

    private handleList(field: CronExpressionField, value: string): ParseFieldResult {
        const parts = value.split(',')
        const result = new Set<number>()

        parts.forEach((part) => {
            if (!part.trim()) {
                throw new CronExpressionParseError('Empty list item', field, value)
            }
            const values = this.parseField(field, part.trim())
            values.forEach(val => result.add(val))
        })

        return Array.from(result).sort((a, b) => a - b)
    }

    private createStepSequence(start: number, max: number, step: number): number[] {
        const result = []
        for (let i = start; i <= max; i += step) {
            result.push(i)
        }
        return result
    }

    private handleStep(field: CronExpressionField, value: string): ParseFieldResult {
        const [rangeStr, stepStr] = value.split('/').map(s => s.trim())
        if (!rangeStr || !stepStr) {
            throw new CronExpressionParseError('Invalid step format', field, value)
        }

        const step = this.parseNumericValue(field, stepStr, value)
        if (step <= 0 || step > CRON_RANGES[field].max) {
            throw new CronExpressionParseError('Invalid step value', field, value)
        }

        if (rangeStr === '*') {
            const { min, max } = CRON_RANGES[field]
            const startValue = field === 'month' ? 2 : min
            return this.createStepSequence(startValue, max, step)
        }

        if (!rangeStr.includes('-')) {
            const start = this.parseNumericValue(field, rangeStr, value)
            return this.createStepSequence(start, CRON_RANGES[field].max, step)
        }

        const baseValues = this.handleRange(field, rangeStr)
        return baseValues.filter((_, index) => index % step === 0)
    }

    private handleRange(field: CronExpressionField, value: string): ParseFieldResult {
        if (!/^\d+\s*-\s*\d+$/.test(value)) {
            throw new CronExpressionParseError('Invalid range format', field, value)
        }

        const [startStr, endStr] = value.split('-').map(s => s.trim())
        const start = this.parseNumericValue(field, startStr, value)
        const end = this.parseNumericValue(field, endStr, value)

        if (start > end) {
            throw new CronExpressionParseError('Range start must be less than or equal to end', field, value)
        }

        return this.createSequence(start, end)
    }

    public parseField(field: CronExpressionField, value: string): ParseFieldResult {
        const trimmedValue = value.trim()
        const range = CRON_RANGES[field]

        switch (true) {
            case trimmedValue === '*':
                return this.handleAsterisk(range)
            case trimmedValue.includes(','):
                return this.handleList(field, trimmedValue)
            case trimmedValue.includes('/'):
                return this.handleStep(field, trimmedValue)
            case trimmedValue.includes('-'):
                return this.handleRange(field, trimmedValue)
            default:
                return [this.parseNumericValue(field, trimmedValue, value)]
        }
    }
}

export default new CronExpressionParser()