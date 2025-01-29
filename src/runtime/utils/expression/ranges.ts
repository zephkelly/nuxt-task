export const CRON_RANGES = {
    minute: { min: 0, max: 59 },
    hour: { min: 0, max: 23 },
    dayOfMonth: { min: 1, max: 31 },
    month: { min: 1, max: 12 },
    dayOfWeek: { min: 0, max: 6 }, // 0 = Sunday
} as const;

export type CronField = keyof typeof CRON_RANGES;



export function validateValue(field: CronField, value: number): boolean {
    if (!Number.isInteger(value)) {
        return false;
    }

    const range = CRON_RANGES[field];
    return value >= range.min && value <= range.max;
}