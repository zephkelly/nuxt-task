import { createHooks } from 'hookable'

import { moduleConfiguration, DEFAULT_MODULE_OPTIONS } from '../../../src/runtime/config'
import { defineTaskHandler, type NuxtCronTaskDefinition } from '../../../src/runtime/server/task/handler'
import {
    attachTaskRuntime,
    getRunState,
    resetTaskRuntime,
} from '../../../src/runtime/server/runs/state'
import { flushTaskRunHooks } from '../../../src/runtime/server/runs/hooks'
import type { TaskInfo } from '../../../src/runtime/server/runs/types'
import type { ModuleOptions } from '../../../src/module'
import { createCustomTriggerAdapter } from '../../../src/runtime/plugin'

export type Mode = 'native' | 'custom'

export function moduleOptionsFor(mode: Mode, overrides: Partial<ModuleOptions> = {}): ModuleOptions {
    return {
        ...DEFAULT_MODULE_OPTIONS,
        experimental: { tasks: mode === 'native' },
        ...overrides,
    } as ModuleOptions
}

/**
 * A faithful copy of Nitro 2.x's runTask (nitropack/dist/runtime/internal/
 * task.mjs): it returns the in-flight promise for a running name before it
 * reads the payload, and awaits `resolve()` before calling `run()`.
 */
export function createNitroRunTask(tasks: Record<string, any>) {
    const running: Record<string, Promise<any> | undefined> = {}

    return async function runTask(
        name: string,
        { payload = {}, context = {} }: { payload?: any, context?: any } = {},
    ) {
        if (running[name]) {
            return running[name]
        }
        if (!(name in tasks)) {
            throw new Error(`Task \`${name}\` is not available!`)
        }
        const handler = await Promise.resolve(tasks[name])
        running[name] = handler.run({ name, payload, context })
        try {
            return await running[name]
        }
        finally {
            delete running[name]
        }
    }
}

export interface Harness {
    mode: Mode
    hooks: ReturnType<typeof createHooks<any>>
    events: Array<{ hook: string, event: any }>
    /** Runs a task the way a scheduler in this mode would. */
    fire: (name: string, extra?: { payload?: any, scheduledFor?: Date | null }) => Promise<any>
    define: <T>(name: string, def: Partial<NuxtCronTaskDefinition<T>> & Pick<NuxtCronTaskDefinition<T>, 'handler'>) => any
    flush: () => Promise<void>
}

/**
 * Sets up nuxt-task's run runtime as one mode's plugin would, with real
 * hookable hooks and a recorder on every run hook.
 */
export function createHarness(mode: Mode, options: Partial<ModuleOptions> = {}): Harness {
    resetTaskRuntime()
    const moduleOptions = moduleOptionsFor(mode, options)
    moduleConfiguration.setModuleOptions(moduleOptions)

    const hooks = createHooks<any>()
    const events: Array<{ hook: string, event: any }> = []

    for (const hook of ['task:run:start', 'task:run:attempt-failed', 'task:run:finish']) {
        hooks.hook(hook, (event: any) => {
            events.push({ hook, event })
        })
    }

    const definitions: Record<string, any> = {}
    const registry: TaskInfo[] = []

    const nitroRunTask = createNitroRunTask(definitions)

    const define: Harness['define'] = (name, def) => {
        const task = defineTaskHandler({
            meta: { name: `Meta ${name}` },
            schedule: '*/15 * * * *',
            ...def,
        } as NuxtCronTaskDefinition)

        definitions[name] = task
        getRunState().definitionNames.set(task, name)
        registry.push({
            name,
            metaName: `Meta ${name}`,
            description: undefined,
            schedule: def.schedule === undefined ? '*/15 * * * *' : def.schedule,
            options: {},
            parked: false,
        })

        if (mode === 'custom') {
            getRunState().adapter = createCustomTriggerAdapter(
                Object.entries(definitions).map(([n, d]) => ({ name: n, definition: d })),
                moduleOptions,
            )
        }

        return task
    }

    attachTaskRuntime({
        nitroApp: { hooks },
        mode,
        registry,
        adapter: mode === 'native'
            ? (name, { payload, context }) => nitroRunTask(name, { payload, context })
            : undefined,
    })

    const fire: Harness['fire'] = (name, extra = {}) => {
        if (mode === 'native') {
            // Nitro's schedule runner: one boot-time payload for every fire.
            return nitroRunTask(name, {
                payload: extra.payload ?? { scheduledTime: 0 },
                context: {},
            })
        }

        // The custom scheduler's queue calls execute(ctx) through the
        // wrapper addTasksToScheduler installs.
        const task = definitions[name]
        const internal = task[Symbol.for('nuxt-task:run-internal')]
        const ctx = {
            name,
            scheduledTime: Date.now(),
            scheduledFor: extra.scheduledFor ?? null,
            timezone: 'UTC',
            ...extra.payload,
        }
        return internal(ctx, { name, scheduled: { scheduledFor: ctx.scheduledFor } })
    }

    return {
        mode,
        hooks,
        events,
        fire,
        define,
        flush: () => flushTaskRunHooks(),
    }
}

export function finishEvents(h: Harness) {
    return h.events.filter(e => e.hook === 'task:run:finish').map(e => e.event)
}

export function deferred<T = void>() {
    let resolve!: (value: T) => void
    let reject!: (error: unknown) => void
    const promise = new Promise<T>((res, rej) => {
        resolve = res
        reject = rej
    })
    return { promise, resolve, reject }
}
