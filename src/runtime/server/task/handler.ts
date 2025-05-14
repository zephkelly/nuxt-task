import { moduleConfiguration } from '../../config'
import type { CronTaskOptions } from '../../task/types'
import CronExpressionParser from '../../expression/parser'
import type { ModuleOptions } from '../../../module'

import { useRuntimeConfig } from '#build/types/nitro-imports'



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
    let moduleOptions: ModuleOptions | undefined = undefined

    try {
        const runtimeConfig = useRuntimeConfig()
        moduleOptions = runtimeConfig?.cron
    }
    catch(error: unknown) {
        moduleOptions = moduleConfiguration.getModuleOptions()
    }

    
    const baseTask = {
        meta: {
            name: definition.meta?.name,
            description: definition.meta.description,
        },
        schedule: definition.schedule,
        options: definition.options || {},
    }

    // If using Nitro's experimental tasks
    if (moduleOptions?.experimental?.tasks) {
        console.log('📋 Registered Nitro task:', definition.meta.name)
        return {
            ...baseTask,
            // Return the handler directly for Nitro tasks
            async run({ payload, context }: { payload?: Record<string, any>, context?: Record<string, any> }) {
                try {
                    CronExpressionParser.parseCronExpression(definition.schedule, {
                        timezone: moduleOptions.timezone
                    })
                }
                catch (error) {
                    throw new Error(`Invalid cron expression in task definition: ${(error as Error).message}`)
                }

                try {
                    const result = await definition.handler({ 
                        payload, 
                        ...context,
                        options: moduleOptions
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

    console.log('📋 Registered nuxt-cron task:', definition.meta.name)

    return {
        ...baseTask,
        async run(context: TaskContext) {
            try {
                CronExpressionParser.parseCronExpression(definition.schedule, {
                    timezone: moduleOptions?.timezone
                })
                return await definition.handler(context)
            }
            catch (error) {
                throw error instanceof Error ? error : new Error('Unknown error in task execution')
            }
        },
        _custom: {
            type: 'cron-task',
            version: '1.0',
            virtual: true
        }
    }
}