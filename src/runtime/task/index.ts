import { moduleConfiguration } from '../config'
import type { CronTaskOptions } from './types'

import type { ModuleOptions } from './../../module'

export function validateTaskTimezone<T extends ModuleOptions>(
        taskOptions: CronTaskOptions<T>,
): void {
        const moduleOptions: ModuleOptions = moduleConfiguration.getModuleOptions()
  const isStrictMode = moduleOptions.timezone.strict
  const hasTaskTimezone = 'timezone' in taskOptions

  if (isStrictMode && hasTaskTimezone) {
                throw new Error(
                        "Cannot set per-task timezone when timezone.strict is enabled. "
      + 'Use the module-level timezone configuration instead.',
    );
        }
}
