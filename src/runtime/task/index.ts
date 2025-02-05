import type {
    CronTaskOptions,
    FlexibleCronTaskOptions,
} from './types'

import { type FlexibleTimezoneOptions, type StrictTimezoneOptions } from './../utils/timezone';
import { type ModuleOptions } from './../../module'
import { getModuleOptions } from '../config'



export function validateTaskTimezone<T extends ModuleOptions>(
    taskOptions: CronTaskOptions<T>,
): void {
    const moduleOptions: ModuleOptions = getModuleOptions();
    const isStrictMode = moduleOptions.timezone.strict
    const hasTaskTimezone = 'timezone' in taskOptions

    if (isStrictMode && hasTaskTimezone) {
        throw new Error(
            'Cannot set per-task timezone when timezone.strict is enabled. '
            + 'Use the module-level timezone configuration instead.',
        )
    }
}