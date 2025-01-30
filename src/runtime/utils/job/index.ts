import type {
    CronJobOptions,
    FlexibleCronJobOptions,
} from './types'

import type { ModuleOptions, StrictTimezoneModuleOptions } from '~/src/module'



export function validateJobTimezone<T extends ModuleOptions>(
    moduleOptions: T,
    jobOptions: CronJobOptions<T>,
): void {
    const isStrictMode = moduleOptions.timezone.strict
    const hasJobTimezone = 'timezone' in jobOptions

    if (isStrictMode && hasJobTimezone) {
        throw new Error(
            'Cannot set per-job timezone when timezone.strict is enabled. '
            + 'Use the module-level timezone configuration instead.',
        )
    }
}

export function isStrictTimezoneOptions(
    options: ModuleOptions,
): options is StrictTimezoneModuleOptions {
    return options.timezone.strict === true
}

export function getEffectiveTimezone<T extends ModuleOptions>(
    moduleOptions: T,
    jobOptions: CronJobOptions<T>,
): string {
    if (isStrictTimezoneOptions(moduleOptions)) {
        return moduleOptions.timezone.type
    }

    return (jobOptions as FlexibleCronJobOptions).timezone || moduleOptions.timezone.type || 'UTC'
}
