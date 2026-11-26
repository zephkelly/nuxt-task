import { defineNitroPlugin } from 'nitropack/dist/runtime/plugin'
import { createServerStorage } from './storage/server'
import { Scheduler } from './scheduler'
import { resolveModuleOptions } from './config'
import { RUN_TASK_INTERNAL } from './server/task/handler'
import type { InternalRunInput } from './server/task/handler'
import { attachTaskRuntime, getRunState } from './server/runs/state'
import type { TriggerAdapter } from './server/runs/state'
import { flushTaskRunHooks } from './server/runs/hooks'
import { TaskNotFoundError } from './server/runs/errors'
import { resolveCustomTimezone } from './server/runs/schedule'
import type { TaskInfo } from './server/runs/types'
import { useRuntimeConfig } from '#imports'

export interface TaskDefinition {
    meta: {
        name: string
    }
    schedule: string
    options?: Record<string, any>
    run: (args: any) => Promise<any>
}

/**
 * Load tasks from the virtual #tasks module
 * Extracted for easier testing
 */
export async function loadTasks(): Promise<TaskDefinition[]> {
    try {
        // @ts-ignore - virtual file
        const tasksVirtualFile = await import('#tasks')
        const defs = tasksVirtualFile.taskDefinitions || []
        // Defensive: a mis-shaped default export shouldn't crash the scheduler.
        // (A task that fails to compile still hard-fails the build, as intended.)
        return defs.filter(
            (t: any) => t && t.meta && typeof t.meta.name === 'string',
        )
    } catch {
        return []
    }
}

export interface NamedTaskDefinition {
    /** Path name, e.g. `db:migrate`. */
    name: string
    definition: TaskDefinition
}

/**
 * Load tasks from `#tasks` paired with their path names. Falls back to
 * `meta.name` when the virtual module predates `taskNames`.
 */
export async function loadNamedTasks(): Promise<NamedTaskDefinition[]> {
    try {
        // @ts-ignore - virtual file
        const mod = await import('#tasks')
        const defs: any[] = mod.taskDefinitions || []
        const names: unknown[] = mod.taskNames || []

        return defs
            .map((definition, i) => ({
                definition,
                name: typeof names[i] === 'string'
                    ? names[i] as string
                    : definition?.meta?.name,
            }))
            .filter(
                ({ definition, name }) =>
                    definition
                    && definition.meta
                    && typeof definition.meta.name === 'string'
                    && typeof name === 'string',
            )
    } catch {
        return []
    }
}

/**
 * Load the build-time task registry. Empty when it cannot be read.
 */
export async function loadTaskRegistry(): Promise<TaskInfo[]> {
    try {
        // @ts-ignore - virtual file
        const mod = await import('#nuxt-task/registry')
        return Array.isArray(mod.taskRegistry) ? mod.taskRegistry : []
    } catch {
        return []
    }
}

function getInternalRun(definition: any):
    | ((context: any, input: InternalRunInput) => Promise<any>)
    | undefined {
    const run = definition?.[RUN_TASK_INTERNAL]
    return typeof run === 'function' ? run : undefined
}

/**
 * Trigger adapter for custom mode: runs a definition directly, inside the
 * caller's trigger context, with the payload merged as native mode does.
 */
export function createCustomTriggerAdapter(
    named: NamedTaskDefinition[],
    moduleOptions: any,
): TriggerAdapter {
    const byName = new Map(named.map(t => [t.name, t.definition]))

    return async (name, { payload, context }) => {
        const definition = byName.get(name)
        if (!definition) throw new TaskNotFoundError(name)

        const ctx = {
            ...context,
            ...payload,
            name,
            scheduledTime: Date.now(),
            timezone: resolveCustomTimezone(
                moduleOptions,
                definition.options?.timezone,
            ),
        }

        const internal = getInternalRun(definition)
        return internal ? internal(ctx, { name }) : definition.run(ctx)
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
 *
 * Definitions built by defineTaskHandler run through the shared run
 * executor, which owns retries and timeout so that retries count as one run.
 * The queue therefore gets those options stripped, and the scheduler task is
 * named by its path name. Other shapes are added as before.
 */
export async function addTasksToScheduler(
    scheduler: any,
    taskDefinitions: TaskDefinition[],
    taskNames: string[] = [],
): Promise<void> {
    for (const [i, task] of taskDefinitions.entries()) {
        const internal = getInternalRun(task)

        if (!internal) {
            await scheduler.addTask({
                name: task.meta.name,
                options: { expression: task.schedule, ...task.options },
                execute: task.run,
            })
            continue
        }

        const name = taskNames[i] ?? task.meta.name
        const {
            maxRetries: _maxRetries,
            timeout: _timeout,
            retryDelay: _retryDelay,
            ...queueOptions
        } = task.options || {}

        await scheduler.addTask({
            name,
            options: { expression: task.schedule, ...queueOptions },
            execute: (ctx: any) =>
                internal(ctx, {
                    name,
                    scheduled: { scheduledFor: ctx?.scheduledFor ?? null },
                }),
        })
    }
}

/**
 * Main plugin initialization logic
 * Now much easier to test
 */
export async function initializePlugin(nitroApp: any): Promise<void> {
    const config = useRuntimeConfig()
    const moduleOptions = resolveModuleOptions(config)

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

    // Load tasks, and connect the run API before anything can trigger one
    const named = await loadNamedTasks()
    const state = getRunState()
    for (const { name, definition } of named) {
        state.definitionNames.set(definition, name)
    }

    attachTaskRuntime({
        nitroApp,
        mode: 'custom',
        adapter: createCustomTriggerAdapter(named, moduleOptions),
        registry: await loadTaskRegistry(),
    })

    if (named.length === 0) {
        console.warn('No tasks found, skipping scheduler.')
        return
    }

    // Initialize scheduler
    const { storage, scheduler } = await initializeScheduler(moduleOptions)

    // Add tasks
    await addTasksToScheduler(
        scheduler,
        named.map(t => t.definition),
        named.map(t => t.name),
    )

    // Start scheduler
    await scheduler.start()

    // Register cleanup. Flush run hooks last so a graceful shutdown does not
    // drop the final finish events.
    nitroApp.hooks.hook('close', async () => {
        await scheduler.stop()
        await flushTaskRunHooks()
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