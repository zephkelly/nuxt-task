import { defineNitroPlugin } from 'nitropack/dist/runtime/plugin'
import { createServerStorage } from './storage/server'
import { Scheduler } from './scheduler'
import { moduleConfiguration } from './config'
import { useRuntimeConfig } from '#imports'

export interface TaskDefinition {
    meta: {
        name: string
    }
    schedule: string
    options?: Record<string, any>
    run: (args: any) => Promise<any>
}

export interface PluginContext {
    config: any
    storage: any
    scheduler: any
    taskDefinitions: TaskDefinition[]
}

/**
 * Load tasks from the virtual #tasks module
 * Extracted for easier testing
 */
export async function loadTasks(): Promise<TaskDefinition[]> {
    try {
        // @ts-ignore - virtual file
        const tasksVirtualFile = await import('#tasks')
        return tasksVirtualFile.taskDefinitions || []
    } catch {
        return []
    }
}

/**
 * Check if plugin should be skipped
 * Extracted for easier testing
 */
export function shouldSkipInitialization(
    config: any,
    isTestEnv: boolean = import.meta.test
): {
    skip: boolean
    reason?: string
} {
    if (config?.experimental?.tasks) {
        return {
            skip: true,
            reason: "Experimental tasks are enabled, using Nitro's native task scheduler.",
        }
    }

    if (isTestEnv) {
        return {
            skip: true,
            reason: 'Skipping scheduler in test environment',
        }
    }

    return { skip: false }
}

/**
 * Initialize the scheduler with tasks
 * Extracted for easier testing
 */
export async function initializeScheduler(
    moduleOptions: any
): Promise<{ storage: any; scheduler: any }> {
    const storage = await createServerStorage({ type: 'memory' })

    const scheduler = new Scheduler(storage, moduleOptions, {
        tickInterval: 1000,
        maxConcurrent: 10,
        handleMissedTasks: true,
    })

    return { storage, scheduler }
}

/**
 * Add tasks to the scheduler
 * Extracted for easier testing
 */
export async function addTasksToScheduler(
    scheduler: any,
    taskDefinitions: TaskDefinition[]
): Promise<void> {
    for (const task of taskDefinitions) {
        await scheduler.addTask({
            name: task.meta.name,
            options: { expression: task.schedule, ...task.options },
            execute: task.run,
        })
    }
}

/**
 * Main plugin initialization logic
 * Now much easier to test
 */
export async function initializePlugin(nitroApp: any): Promise<void> {
    const config = useRuntimeConfig()
    const moduleOptions = config.cron || moduleConfiguration.getModuleOptions()

    // Check if we should skip
    const skipCheck = shouldSkipInitialization(moduleOptions)
    if (skipCheck.skip) {
        if (skipCheck.reason?.includes('test')) {
            console.log(skipCheck.reason)
        } else {
            console.warn(skipCheck.reason)
        }
        return
    }

    // Load tasks
    const taskDefinitions = await loadTasks()
    if (taskDefinitions.length === 0) {
        console.warn('No tasks found, skipping scheduler.')
        return
    }

    // Initialize scheduler
    const { storage, scheduler } = await initializeScheduler(moduleOptions)

    // Add tasks
    await addTasksToScheduler(scheduler, taskDefinitions)

    // Start scheduler
    await scheduler.start()

    // Register cleanup
    nitroApp.hooks.hook('close', async () => {
        await scheduler.stop()
    })

    // Attach to nitroApp
    // @ts-ignore
    nitroApp.scheduler = scheduler
}

/**
 * Default export - Nitro plugin
 */
export default defineNitroPlugin(async (nitroApp) => {
    try {
        await initializePlugin(nitroApp)
    } catch (error) {
        console.error('Failed to initialize cron scheduler:', error)
    }
})