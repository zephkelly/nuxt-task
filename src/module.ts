import { defu } from 'defu'
import { join } from 'pathe'
import { readdir, access } from 'fs/promises'
import { constants } from 'fs'
import { defineNuxtModule, addPlugin, createResolver, addImports } from '@nuxt/kit'


import type { StorageType } from './runtime/storage'

import type { FlexibleTimezoneOptions, StrictTimezoneOptions } from './runtime/utils/timezone'

import { defaultModuleOptions, setModuleOptions } from './runtime/config'

import { scanTasksDirectory } from './runtime/server/nitro/utils/scanTasks'




interface BaseModuleOptions {
    serverTasks?: boolean
    clientTasks?: boolean
    experimental?: {
        tasks?: boolean
    }
    storage?: {
        type?: StorageType
        config?: Record<string, any>
    }
}

export interface FlexibleTimezoneModuleOptions extends BaseModuleOptions {
    timezone: FlexibleTimezoneOptions
}

export interface StrictTimezoneModuleOptions extends BaseModuleOptions {
    timezone: StrictTimezoneOptions
}

// Type used for external configuration
export type ModuleOptions = FlexibleTimezoneModuleOptions | StrictTimezoneModuleOptions



export default defineNuxtModule<ModuleOptions>({
    meta: {
        name: 'nuxt-cron',
        configKey: 'cron',
        compatibility: {
            nuxt: '^3.10.0 || ^4.0.0',
        },
    },
    defaults: defaultModuleOptions as ModuleOptions,
    setup(moduleOptions, nuxt) {
        const { resolve } = createResolver(import.meta.url)
        const runtimeDir = resolve('./runtime')
        
        // Ensure options are properly merged
        const options = defu(moduleOptions, defaultModuleOptions) as ModuleOptions
    
        // Add runtime directory to Nuxt
        nuxt.options.build = nuxt.options.build || {}
        nuxt.options.build.transpile = nuxt.options.build.transpile || []
        nuxt.options.build.transpile.push(runtimeDir)
    
        // Setup runtime config
        nuxt.options.runtimeConfig.public = nuxt.options.runtimeConfig.public || {}
        nuxt.options.runtimeConfig.public.cron = options
    
        // Add auto-imports for the task handler
        addImports([
          {
            name: 'defineTaskHandler',
            as: 'defineTaskHandler',
            from: resolve(join(runtimeDir, 'server/nitro/handler')), // Adjust path based on your structure
          }
        ])
    
        // Add module aliases
        nuxt.options.alias['#nuxt-cron'] = runtimeDir
        
        // Ensure consistent options across Nitro
        nuxt.hook('nitro:config', (nitroConfig) => {
          nitroConfig.alias = nitroConfig.alias || {}
          nitroConfig.alias['#nuxt-cron'] = runtimeDir
    
          // Add virtual imports
          nitroConfig.virtual = nitroConfig.virtual || {}
          nitroConfig.virtual['#nuxt-cron/types'] = `export * from '${resolve('./runtime/types')}'`
          nitroConfig.virtual['#cron-config'] = `export default ${JSON.stringify(options)}`
          
          // Ensure runtime config is consistent
          nitroConfig.runtimeConfig = nitroConfig.runtimeConfig || {}
          nitroConfig.runtimeConfig.public = nitroConfig.runtimeConfig.public || {}
          nitroConfig.runtimeConfig.public.cron = options
    
          // Explicitly set experimental tasks in Nitro config
          if (options.experimental?.tasks) {
            nitroConfig.experimental = nitroConfig.experimental || {}
            nitroConfig.experimental.tasks = true
          }
        })
    
        // Add runtime plugin
        addPlugin({
          src: resolve('./runtime/plugin')
        })
    
        // Debug logging
        console.log('Runtime directory:', runtimeDir)
        console.log('Module options:', options)
    }
})


export async function configureNitroTasks(
    options: ModuleOptions,
    nitroConfig: any,
    nuxt: any
) {
    if (!options.experimental?.tasks) return

    // Initialize Nitro configuration with empty objects if undefined
    nitroConfig.tasks = nitroConfig.tasks || {}
    nitroConfig.scheduledTasks = nitroConfig.scheduledTasks || []
    nitroConfig.handlers = nitroConfig.handlers || {}

    try {
        // Use the Nuxt app's server/tasks directory
        const tasksDir = join(nuxt.options.serverDir, 'tasks')

        // Check if directory exists before proceeding
        try {
            await access(tasksDir, constants.R_OK)
        } catch (error) {
            console.warn('No tasks directory found at:', tasksDir)
            // Initialize empty tasks object even if directory doesn't exist
            nitroConfig.tasks = {}
            return
        }

        const tasks = await scanTasksDirectory(tasksDir)
        
        // Group tasks by cron expression for scheduled tasks
        const scheduledTasksMap = new Map<string, string[]>()
        
        for (const task of tasks) {
            try {
                // Get the relative path from the tasks directory
                const relativePath = task.path.substring(tasksDir.length + 1)
                // Convert the path to the module import path format
                const modulePath = relativePath.replace(/\.[^/.]+$/, '') // Remove extension

                const taskModule = await import(task.path)
                if (taskModule?.default?.meta) {
                    // Register task metadata
                    nitroConfig.tasks[task.name] = {
                        name: task.name,
                        description: taskModule.default.meta.description || '',
                        handler: `~/server/tasks/${modulePath}`
                    }

                    // If task has a schedule, add it to scheduled tasks
                    if (taskModule.default.meta.schedule) {
                        const cronExpression = taskModule.default.meta.schedule
                        const tasks = scheduledTasksMap.get(cronExpression) || []
                        tasks.push(task.name)
                        scheduledTasksMap.set(cronExpression, tasks)
                    }

                    // Register task handler route
                    nitroConfig.handlers[`/_nitro/tasks/${task.name}`] = {
                        method: 'post',
                        handler: `~/server/tasks/${modulePath}`
                    }
                }
            } catch (error) {
                console.warn(`Failed to load task ${task.name}:`, error)
            }
        }

        // Convert scheduled tasks map to array format expected by Nitro
        nitroConfig.scheduledTasks = Array.from(scheduledTasksMap.entries()).map(
            ([cron, tasks]) => ({ cron, tasks })
        )

        // Register the tasks list endpoint
        nitroConfig.handlers['/_nitro/tasks'] = {
            method: 'get',
            handler: createTaskListHandler(nitroConfig)
        }

    } catch (error) {
        console.warn('Error configuring Nitro tasks:', error)
        // Initialize empty tasks object even if there's an error
        nitroConfig.tasks = {}
    }
}

// Make sure createTaskListHandler returns a proper response
function createTaskListHandler(nitroConfig: any) {
    return () => ({
        tasks: nitroConfig.tasks || {},
        scheduledTasks: nitroConfig.scheduledTasks || []
    })
}