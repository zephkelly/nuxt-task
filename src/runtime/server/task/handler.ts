import { moduleConfiguration } from '../../config'
import type { CronTaskOptions } from '../../task/types'
import CronExpressionParser from '../../expression/parser'
import type { ModuleOptions } from '../../../module'



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

export function defineTaskHandler<T = any>(
    definition: NuxtCronTaskDefinition<T>
) {

    let config: ModuleOptions | undefined = undefined
    try {
        //@ts-ignore
        config = useRuntimeConfig().nuxtTask as ModuleOptions
    }
    catch (error) {
        config = moduleConfiguration.getModuleOptions()
    }

    const baseTask = {
        meta: {
            name: definition.meta?.name,
            description: definition.meta.description,
        },
        schedule: definition.schedule,
        options: definition.options || {},
    }

    if (config?.experimental?.tasks) {
        return {
            ...baseTask,
            // Return the handler directly for Nitro tasks
            async run({ payload, context }: { payload?: Record<string, any>, context?: Record<string, any> }) {
                try {
                    CronExpressionParser.parseCronExpression(definition.schedule, {
                        timezone: config.timezone
                    })
                }
                catch (error) {
                    throw new Error(`Invalid cron expression in task definition: ${(error as Error).message}`)
                }

                try {
                    const result = await definition.handler({ 
                        payload, 
                        ...context,
                        timezone: config.timezone.type
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
    }

    return {
        ...baseTask,
        async run(context: TaskContext) {
            try {
                CronExpressionParser.parseCronExpression(definition.schedule, {
                    timezone: config?.timezone
                })
                return await definition.handler(context)
            }
            catch (error) {
                throw error instanceof Error ? error : new Error('Unknown error in task execution')
            }
        },
        _custom: {
            type: 'nuxt-task',
            version: '1.0',
            virtual: true
        }
    }
}