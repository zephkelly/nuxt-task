import type {
    CronTaskOptions,
    FlexibleCronTaskOptions,
} from './types'

import { type ModuleOptions, type StrictTimezoneModuleOptions } from './../../module'
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

export function isStrictTimezoneOptions(
    options: ModuleOptions,
): options is StrictTimezoneModuleOptions {
    if (!options.timezone) {
        return false
    }
    
    return options.timezone.strict === true
}

export function getEffectiveTimezone<T extends ModuleOptions>(
    moduleOptions: T,
    taskOptions: CronTaskOptions<T>,
): string {
    if (isStrictTimezoneOptions(moduleOptions as ModuleOptions)) {
        return moduleOptions.timezone.type
    }

    return (taskOptions as FlexibleCronTaskOptions).timezone || moduleOptions.timezone.type || 'UTC'
}
