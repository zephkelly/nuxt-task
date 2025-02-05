import type { CronTaskOptions, CronTask } from '../../task/types'
import CronExpressionParser from '../../expression/parser'

import type { ModuleOptions } from './../../../module'


interface TaskContext {
    payload?: Record<string, any>
    [key: string]: any
}

interface TaskMeta {
    name: string
    description?: string
}

export interface NuxtCronTaskDefinition<T = any> {
    meta: TaskMeta
    schedule: string
    handler: (ctx: TaskContext) => Promise<T>
    options?: Omit<CronTaskOptions, 'expression'> & {
        timezone?: string
    }
}

export function defineTaskHandler<T = any>(definition: NuxtCronTaskDefinition<T>) {
    const taskDefinition = {
        meta: {
            name: definition.meta?.name,
            description: definition.meta.description,
        },
        async run({ payload, context }: { payload?: Record<string, any>, context?: Record<string, any> }) {
            const moduleOptions: ModuleOptions = useRuntimeConfig().cron

            if (!moduleOptions.experimental?.tasks) {
                throw new Error('Experimental tasks must be enabled in the module options to use defineTaskHandler')
            }

            // Validate cron expression
            try {
                CronExpressionParser.parseCronExpression(definition.schedule, {
                    timezone: moduleOptions.timezone
                })
            } catch (error) {
                throw new Error(`Invalid cron expression in task definition: ${(error as Error).message}`)
            }

            try {
                const result = await definition.handler({ 
                    payload, 
                    ...context,
                    options: moduleOptions // Pass module options to handler
                })
                return { success: true, result }
            }
            catch (error) {
                console.error(`Task execution failed: ${(error as Error).message}`)
                return {
                    success: false,
                    error: error instanceof Error ? error.message : 'Unknown error'
                }
            }
        }
    }

    return taskDefinition
}