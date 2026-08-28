import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'pathe'

import { configureNitroTasks } from '../../../src/module'
import { ModuleConfiguration } from '../../../src/runtime/config'
import { createServerStorage } from '../../../src/runtime/storage/server'
import type { ModuleOptions } from '../../../src/module'

/**
 * Options the module advertises but never acted on, and a storage factory
 * that threw for types its own type union offered.
 */

function makeNuxt(serverDir: string) {
    return { options: { dev: false, buildDir: '/build', serverDir } }
}

function taskFile(name: string) {
    return [
        `import { defineTaskHandler } from 'nuxt-task/handler'`,
        ``,
        `export default defineTaskHandler({`,
        `    meta: { name: '${name}', description: 'A task' },`,
        `    schedule: '0 3 * * *',`,
        `    async handler() { return { ok: true } },`,
        `})`,
        ``,
    ].join('\n')
}

describe('module options', () => {
    let dir: string
    let logSpy: any
    let warnSpy: any

    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), 'nuxt-task-opts-'))
        logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
        warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    })

    afterEach(async () => {
        logSpy.mockRestore()
        warnSpy.mockRestore()
        await rm(dir, { recursive: true, force: true })
    })

    describe('tasksDir', () => {
        it('scans a custom tasks directory', async () => {
            // tasksDir was declared on ModuleOptions and documented, but both
            // execution modes hard-coded <serverDir>/tasks and never read it.
            const custom = join(dir, 'scheduled')
            await mkdir(custom, { recursive: true })
            await writeFile(join(custom, 'cleanup.ts'), taskFile('cleanup'))

            const cfg: any = { handlers: [] }
            await configureNitroTasks(
                { experimental: { tasks: true }, tasksDir: 'scheduled' } as any,
                cfg,
                makeNuxt(dir),
            )

            expect(Object.keys(cfg.tasks)).toEqual(['cleanup'])
        })

        it('still defaults to the tasks directory', async () => {
            const standard = join(dir, 'tasks')
            await mkdir(standard, { recursive: true })
            await writeFile(join(standard, 'cleanup.ts'), taskFile('cleanup'))

            const cfg: any = { handlers: [] }
            await configureNitroTasks(
                { experimental: { tasks: true } } as any,
                cfg,
                makeNuxt(dir),
            )

            expect(Object.keys(cfg.tasks)).toEqual(['cleanup'])
        })

        it('accepts an absolute tasks directory', async () => {
            const custom = join(dir, 'elsewhere')
            await mkdir(custom, { recursive: true })
            await writeFile(join(custom, 'cleanup.ts'), taskFile('cleanup'))

            const cfg: any = { handlers: [] }
            await configureNitroTasks(
                { experimental: { tasks: true }, tasksDir: custom } as any,
                cfg,
                makeNuxt(dir),
            )

            expect(Object.keys(cfg.tasks)).toEqual(['cleanup'])
        })
    })

    describe('validateModuleOptions', () => {
        const base: ModuleOptions = {
            serverTasks: true,
            clientTasks: false,
            experimental: { tasks: false },
            storage: { type: 'memory' },
            timezone: { type: 'UTC', validate: true, strict: false },
        }

        it('accepts a well-formed configuration', () => {
            expect(ModuleConfiguration.validateModuleOptions(base)).toBe(true)
        })

        it('rejects a configuration with no timezone type', () => {
            expect(ModuleConfiguration.validateModuleOptions({
                ...base,
                timezone: { validate: true, strict: false },
            } as any)).toBe(false)
        })

        it('rejects native tasks without server tasks', () => {
            expect(ModuleConfiguration.validateModuleOptions({
                ...base,
                serverTasks: false,
                experimental: { tasks: true },
            })).toBe(false)
        })
    })

    describe('server storage', () => {
        it('creates memory storage', async () => {
            await expect(createServerStorage({ type: 'memory' }))
                .resolves.toBeDefined()
        })

        it('falls back to memory for an unimplemented backend', async () => {
            // 'redis' and 'database' are in the type union with no
            // implementation behind them, so asking for one threw at boot.
            const storage = await createServerStorage({ type: 'redis' } as any)

            expect(storage).toBeDefined()
        })

        it('warns when falling back', async () => {
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

            await createServerStorage({ type: 'database' } as any)

            const warned = warn.mock.calls.map((c: any[]) => c.join(' ')).join('\n')
            expect(warned).toContain('database')
            expect(warned.toLowerCase()).toContain('memory')

            warn.mockRestore()
        })

        it('still rejects a browser-only backend on the server', async () => {
            await expect(createServerStorage({ type: 'localStorage' } as any))
                .rejects.toThrow()
        })
    })
})
