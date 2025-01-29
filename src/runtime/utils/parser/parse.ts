import {
    type CronField,
    CRON_RANGES,
    validateValue
} from './ranges';

import { CronParseError } from './error';



type ParseFieldResult = number[];
type RangeDefinition = { min: number; max: number };

export interface ParsedCron {
    minute: number[];
    hour: number[];
    dayOfMonth: number[];
    month: number[];
    dayOfWeek: number[];
}


function createSequence(min: number, max: number): number[] {
    return Array.from({ length: max - min + 1 }, (_, i) => min + i);
}


function parseNumericValue(field: CronField, value: string, context: string): number {
    const num = Number(value);
    if (isNaN(num)) {
        throw new CronParseError('Invalid number format', field, context);
    }
    if (!validateValue(field, num)) {
        throw new CronParseError('Value out of range', field, context);
    }
    return num;
};



function handleAsterisk(range: RangeDefinition): ParseFieldResult {
    return createSequence(range.min, range.max);
};


function handleList(field: CronField, value: string): ParseFieldResult {
    const parts = value.split(',');
    const result = new Set<number>();

    parts.forEach(part => {
        if (!part.trim()) {
            throw new CronParseError('Empty list item', field, value);
        }
        const values = parseField(field, part.trim());
        values.forEach(val => result.add(val));
    });

    return Array.from(result).sort((a, b) => a - b);
};



function createStepSequence(start: number, max: number, step: number): number[] {
    const result = [];
    for (let i = start; i <= max; i += step) {
        result.push(i);
    }
    return result;
}


function handleStep(field: CronField, value: string): ParseFieldResult {
    const [rangeStr, stepStr] = value.split('/').map(s => s.trim());
    if (!rangeStr || !stepStr) {
        throw new CronParseError('Invalid step format', field, value);
    }

    const step = parseNumericValue(field, stepStr, value);
    if (step <= 0 || step > CRON_RANGES[field].max) {
        throw new CronParseError('Invalid step value', field, value);
    }

    // Handle */n pattern
    if (rangeStr === '*') {
        const { min, max } = CRON_RANGES[field];
        const startValue = field === 'month' ? 2 : min;
        return createStepSequence(startValue, max, step);
    }

    // Handle single value with step (e.g., 5/15)
    if (!rangeStr.includes('-')) {
        const start = parseNumericValue(field, rangeStr, value);
        return createStepSequence(start, CRON_RANGES[field].max, step);
    }

    // Handle range with step (e.g., 1-30/5)
    const baseValues = handleRange(field, rangeStr);
    return baseValues.filter((_, index) => index % step === 0);
}



function handleRange(field: CronField, value: string): ParseFieldResult {
    if (!/^\d+\s*-\s*\d+$/.test(value)) {
        throw new CronParseError('Invalid range format', field, value);
    }

    const [startStr, endStr] = value.split('-').map(s => s.trim());
    const start = parseNumericValue(field, startStr, value);
    const end = parseNumericValue(field, endStr, value);

    if (start > end) {
        throw new CronParseError('Range start must be less than or equal to end', field, value);
    }

    return createSequence(start, end);
};


export function parseField(field: CronField, value: string): ParseFieldResult {
    const trimmedValue = value.trim();
    const range = CRON_RANGES[field];

    switch (true) {
        case trimmedValue === '*':
            return handleAsterisk(range);
        case trimmedValue.includes(','):
            return handleList(field, trimmedValue);
        case trimmedValue.includes('/'):
            return handleStep(field, trimmedValue);
        case trimmedValue.includes('-'):
            return handleRange(field, trimmedValue);
        default:
            return [parseNumericValue(field, trimmedValue, value)];
    }
}

export function parseCronExpression(expression: string): ParsedCron {
    const fields = expression.trim().split(/\s+/);

    if (fields.length !== 5) {
        throw new CronParseError(
            `Invalid number of fields: expected 5, got ${fields.length}`
        );
    }

    try {
        return {
            minute: parseField('minute', fields[0]),
            hour: parseField('hour', fields[1]),
            dayOfMonth: parseField('dayOfMonth', fields[2]),
            month: parseField('month', fields[3]),
            dayOfWeek: parseField('dayOfWeek', fields[4]),
        };
    }
    catch (error) {
        if (error instanceof CronParseError) {
            throw error;
        }

        throw new CronParseError('Failed to parse cron expression');
    }
}