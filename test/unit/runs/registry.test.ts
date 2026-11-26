import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'pathe'

import {
    buildTaskRegistry,
    configureNitroTasks,
    generateRegistryModule,
    generateVirtualTasksModule,
} from '../../../src/module'
import { scanTasksDirectory } from '../../../src/runtime/utils/scanTasks'
import { extractTaskMetas } from '../../../src/runtime/utils/extractTaskMeta'
import { listTasks } from '../../../src/runtime/server/runs/registry'
import { attachTaskRuntime, resetTaskRuntime } from '../../../src/runtime/server/runs/state'
import { moduleConfiguration, DEFAULT_MODULE_OPTIONS } from '../../../src/runtime/config'
import { moduleOptionsFor } from './helpers'

function taskFile(opts: { metaName: string, schedule?: string | null, description?: string, options?: string }) {
    const lines = [
        `import { defineTaskHandler } from 'nuxt-task/handler'`,
        `import { helper } from '~/server/utils/helper'`,
        `const TIMEOUT = 5000`,
        `export default defineTaskHandler({`,
        `    meta: { name: '${opts.metaName}'${opts.description ? `, description: '${opts.description}'` : ''} },`,
    ]
    if (opts.schedule === null) lines.push(`    schedule: computeSchedule(),`)
    else if (opts.schedule !== undefined) lines.push(`    schedule: '${opts.schedule}',`)
    if (opts.options) lines.push(`    options: ${opts.options},`)
    lines.push(`    async handler() { return helper() },`, `})`, ``)
    return lines.join('\n')
}

describe('task registry', () => {
    let dir: string
    let tasksDir: string
    let warnSpy: ReturnType<typeof vi.spyOn>
    let logSpy: ReturnType<typeof vi.spyOn>

    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), 'nuxt-task-registry-'))
        tasksDir = join(dir, 'tasks')
        await mkdir(join(tasksDir, 'notifications'), { recursive: true })
        await mkdir(join(tasksDir, 'maintenance'), { recursive: true })

        await writeFile(join(tasksDir, 'notifications', 'daily-reminders.ts'), taskFile({
            metaName: 'Send daily reminders',
            description: 'Morning reminder emails',
            schedule: '0 8 * * *',
            options: `{ timezone: 'Australia/Sydney', timeout: TIMEOUT, maxRetries: 2, exclusive: true }`,
        }))
        await writeFile(join(tasksDir, 'maintenance', 'never.ts'), taskFile({
            metaName: 'Parked task',
            schedule: '0 0 30 2 *',
        }))
        await writeFile(join(tasksDir, 'backfill.ts'), taskFile({ metaName: 'Backfill' }))
        await writeFile(join(tasksDir, 'computed.ts'), taskFile({ metaName: 'Computed', schedule: null }))

        warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
        logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    })

    afterEach(async () => {
        warnSpy.mockRestore()
        logSpy.mockRestore()
        await rm(dir, { recursive: true, force: true })
        resetTaskRuntime()
        moduleConfiguration.setModuleOptions(DEFAULT_MODULE_OPTIONS)
    })

    async function registryFor(mode: 'native' | 'custom') {
        const scanned = await scanTasksDirectory(tasksDir)
        const registry = buildTaskRegistry(await extractTaskMetas(scanned), mode, moduleOptionsFor(mode))
        return { scanned, registry }
    }

    it.each(['native', 'custom'] as const)('listTasks matches the scanned files (%s mode)', async (mode) => {
        const { scanned, registry } = await registryFor(mode)

        // Round-trip through the generated virtual module, as the plugin does.
        const source = generateRegistryModule(registry)
        const loaded = JSON.parse(source.replace(/^export const taskRegistry = /, '').replace(/;\n$/, ''))
        attachTaskRuntime({ mode, registry: loaded })

        const tasks = listTasks()
        expect(tasks.map(t => t.name).sort()).toEqual(scanned.map(t => t.name).sort())
        expect(tasks.map(t => t.name).sort()).toEqual([
            'backfill',
            'computed',
            'maintenance:never',
            'notifications:daily-reminders',
        ])
    })

    it('carries the path name, meta name, description, schedule and literal options', async () => {
        const { registry } = await registryFor('native')
        const reminders = registry.find(t => t.name === 'notifications:daily-reminders')

        expect(reminders).toEqual({
            name: 'notifications:daily-reminders',
            metaName: 'Send daily reminders',
            description: 'Morning reminder emails',
            schedule: '0 8 * * *',
            // `timeout: TIMEOUT` is an identifier, not a literal, so it is left out.
            options: { timezone: 'Australia/Sydney', maxRetries: 2, exclusive: true },
            parked: false,
        })
    })

    it.each(['native', 'custom'] as const)('marks the never-firing schedule as parked (%s mode)', async (mode) => {
        const { registry } = await registryFor(mode)
        const byName = Object.fromEntries(registry.map(t => [t.name, t]))

        expect(byName['maintenance:never'].parked).toBe(true)
        expect(byName['notifications:daily-reminders'].parked).toBe(false)
        expect(byName.backfill).toMatchObject({ schedule: undefined, parked: false, description: undefined })
        expect(byName.computed).toMatchObject({ schedule: undefined, parked: false })
    })

    it('returns copies, so callers cannot change the registry', () => {
        attachTaskRuntime({
            registry: [{ name: 'a', metaName: 'A', description: undefined, schedule: '* * * * *', options: { x: 1 }, parked: false }],
        })
        const [first] = listTasks()
        first.options.x = 2
        first.name = 'changed'

        expect(listTasks()[0]).toMatchObject({ name: 'a', options: { x: 1 } })
    })

    it('is empty before a plugin has attached', () => {
        resetTaskRuntime()
        expect(listTasks()).toEqual([])
    })

    it('native mode publishes the registry as a Nitro virtual module', async () => {
        const nitroConfig: any = { handlers: [] }
        const nuxt = { options: { dev: false, buildDir: '/build', serverDir: dir } }

        await configureNitroTasks({ experimental: { tasks: true } } as any, nitroConfig, nuxt)

        const source: string = nitroConfig.virtual['#nuxt-task/registry']
        const entries = JSON.parse(source.replace(/^export const taskRegistry = /, '').replace(/;\n$/, ''))
        const byName = Object.fromEntries(entries.map((t: any) => [t.name, t]))

        expect(Object.keys(byName).sort()).toEqual([
            'backfill',
            'computed',
            'maintenance:never',
            'notifications:daily-reminders',
        ])
        expect(byName['notifications:daily-reminders'].metaName).toBe('Send daily reminders')
        expect(byName['maintenance:never'].parked).toBe(true)
    })

    it('custom mode\'s #tasks module exports path names aligned with the definitions', async () => {
        const source = await generateVirtualTasksModule(tasksDir)
        const scanned = await scanTasksDirectory(tasksDir)

        scanned.forEach((t, i) => {
            expect(source).toContain(`import task_${i} from ${JSON.stringify(t.path)};`)
        })
        expect(source).toContain(`export const taskNames = ${JSON.stringify(scanned.map(t => t.name))};`)
    })
})
