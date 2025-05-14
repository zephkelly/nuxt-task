import { defineNuxtModule, addServerPlugin, createResolver, addImports, addTemplate } from '@nuxt/kit'
import { join, resolve } from 'pathe'
import { constants } from 'fs'
import { access } from 'fs/promises'

import { moduleConfiguration, DEFAULT_MODULE_OPTIONS } from './runtime/config'

import { scanTasksDirectory } from './runtime/utils/scanTasks'
import { loadTaskModules } from './runtime/utils/loadTasks'

import type { FlexibleTimezoneOptions, StrictTimezoneOptions } from './runtime/utils/timezone'

import type { StorageType } from './runtime/storage'



export interface BaseModuleOptions {
    serverTasks?: boolean
    clientTasks?: boolean
    tasksDir?: string
    experimental?: {
        tasks?: boolean
    }
    storage?: {
        type?: StorageType
        config?: Record<string, any>
    },
}

export type ModuleOptions = BaseModuleOptions & {
    timezone: FlexibleTimezoneOptions | StrictTimezoneOptions
}

export default defineNuxtModule<ModuleOptions>({
    meta: {
        name: 'nuxt-cron',
        configKey: 'cron',
        compatibility: {
            nuxt: '^3.10.0 || ^4.0.0',
        },
    },
    defaults: DEFAULT_MODULE_OPTIONS,
    async setup(moduleOptions, nuxt) {
        const { resolve } = createResolver(import.meta.url)
        const runtimeDir = resolve('./runtime')

        await setupModuleBasics(moduleOptions, nuxt, runtimeDir)
        
        // Support a custom task scheduler or nitro's native implementation
        if (moduleOptions.experimental?.tasks) {
            await setupExperimentalTasks(moduleOptions, nuxt)
        } else {
            await setupCustomTasks(moduleOptions, nuxt)
        }


        if (import.meta.test) {
            console.log('Skipping customer scheduler plugin in test environment')
            return
        }

        addServerPlugin(resolve('./runtime/plugin'))
    }
})

async function setupModuleBasics(moduleOptions: ModuleOptions, nuxt: any, runtimeDir: string) {
    nuxt.options.runtimeConfig.cron = moduleOptions
    moduleConfiguration.setModuleOptions(moduleOptions)
    
    nuxt.options.alias['#nuxt-cron'] = runtimeDir
    nuxt.options.alias['#tasks'] = join(nuxt.options.buildDir, 'tasks.virtual')
    
    addImports([{
        name: 'defineTaskHandler',
        as: 'defineTaskHandler',
        from: join(runtimeDir, 'server/handler'),
        priority: 20
    }])

    addTemplate({
        filename: 'types/nuxt-cron.d.ts',
        getContents: () => `
        declare module '#nuxt-cron' {
            export * from '${resolve('./runtime/types')}'
            export type { ModuleOptions } from '${resolve('./module')}'
        }`
    })
    
    //@ts-ignore - Dont know how to add a type to the reference in this instance
    nuxt.hook('prepare:types', ({ references }) => {
        references.push({ path: resolve(nuxt.options.buildDir, 'types/nuxt-cron.d.ts') })
    })

    const runtimeDirs = [
        resolve('./runtime'),
        resolve('./task'),
        resolve('./server')
    ]
    nuxt.options.build = nuxt.options.build || {}
    nuxt.options.build.transpile = nuxt.options.build.transpile || []
    nuxt.options.build.transpile.push(...runtimeDirs)
}

async function setupExperimentalTasks(moduleOptions: ModuleOptions, nuxt: any) {
    nuxt.hook('nitro:config', async (nitroConfig: any) => {
        setupNitroBasics(nitroConfig, nuxt)
        
        nitroConfig.experimental = nitroConfig.experimental || {}
        nitroConfig.experimental.tasks = true

        await configureNitroTasks(moduleOptions, nitroConfig, nuxt)
    })
}



async function setupCustomTasks(moduleOptions: ModuleOptions, nuxt: any) {
    nuxt.hook('nitro:config', async (nitroConfig: any) => {
        setupNitroBasics(nitroConfig, nuxt)
        await setupVirtualTasksModule(nuxt, nitroConfig)
    })
}



function setupNitroBasics(nitroConfig: any, nuxt: any) {
    const { resolve } = createResolver(import.meta.url)
    
    nitroConfig.alias = nitroConfig.alias || {}
    nitroConfig.alias['#nuxt-cron'] = resolve('./runtime')

    nitroConfig.virtual = nitroConfig.virtual || {}
    nitroConfig.virtual['#nuxt-cron/types'] = `export * from '${resolve('./runtime/types')}'`
    nitroConfig.virtual['#cron-config'] = `export default ${JSON.stringify(nuxt.options.runtimeConfig.cron)}`
}



async function setupVirtualTasksModule(nuxt: any, nitroConfig: any) {
    const tasksDir = join(nuxt.options.serverDir, 'tasks')
    
    try {
        await access(tasksDir, constants.R_OK)
    } catch (error) {
        console.warn('No tasks directory found at:', tasksDir)
        return
    }

    const virtualModule = await generateVirtualTasksModule(tasksDir)
    
    nitroConfig.virtual = nitroConfig.virtual || {}
    nitroConfig.virtual['#tasks'] = virtualModule
}


async function generateVirtualTasksModule(tasksDir: string) {
    const tasks = await scanTasksDirectory(tasksDir)
    const loadedModules = await loadTaskModules(tasks, tasksDir)

    console.log('🔄 Registering custom tasks:', loadedModules.map(task => task.name))

    return `
        ${loadedModules.map(task => `
            import ${task.name.replace(/[:-]/g, '_')} from '~~/server/tasks/${task.path}'
        `).join('\n')}

        export const tasks = [
            ${loadedModules.map(task => task.name.replace(/[:-]/g, '_')).join(',\n')}
        ]

        export const taskDefinitions = tasks.map(task => {
            return {
                ...task,
                _custom: {
                    type: 'cron-task',
                    version: '1.0',
                    virtual: true
                }
            }
        })
    `
}


export async function configureNitroTasks(
    options: ModuleOptions,
    nitroConfig: any,
    nuxt: any
) {
    if (!options.experimental?.tasks) return

    nitroConfig.tasks = nitroConfig.tasks || {}
    nitroConfig.scheduledTasks = nitroConfig.scheduledTasks || []
    nitroConfig.handlers = nitroConfig.handlers || {}

    try {
        const tasksDir = join(nuxt.options.serverDir, 'tasks')

        try {
            await access(tasksDir, constants.R_OK)
        }
        catch (error) {
            console.warn('No tasks directory found at:', tasksDir)
            nitroConfig.tasks = {}
            return
        }

        const tasks = await scanTasksDirectory(tasksDir)
        const loadedModules = await loadTaskModules(tasks, tasksDir)

        const scheduledTasksMap = new Map<string, string[]>()
        
        for (const taskModule of loadedModules) {
            nitroConfig.tasks[taskModule.name] = {
                name: taskModule.name,
                description: taskModule.module.default.meta.description || '',
                handler: `~/server/tasks/${taskModule.path}`
            }

            if (taskModule.module.default.schedule) {
                const cronExpression = taskModule.module.default.schedule
                const tasks = scheduledTasksMap.get(cronExpression) || []
                tasks.push(taskModule.name)
                scheduledTasksMap.set(cronExpression, tasks)
            }

            // Register tasks as Nitro handlers
            nitroConfig.handlers[`/_nitro/tasks/${taskModule.name}`] = {
                method: 'post',
                handler: `~/server/tasks/${taskModule.path}`
            }
        }

        const scheduledTasksObject = Array.from(scheduledTasksMap.entries()).reduce((acc, [cron, tasks]) => {
            acc[cron] = tasks
            return acc
        }, {} as Record<string, string[]>)

        nitroConfig.scheduledTasks = scheduledTasksObject

        nitroConfig.handlers['/_nitro/tasks'] = {
            method: 'get',
            handler: {
                tasks: nitroConfig.tasks || {},
                scheduledTasks: scheduledTasksObject || []
            }
        }
    }
    catch (error) {
        console.warn('Error configuring Nitro tasks:', error)
        nitroConfig.tasks = {}
    }
}