import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'pathe'
import { configureNitroTasks } from '../../../src/module'

/**
 * Exercises the per-task registration loop in `configureNitroTasks` against
 * real files on disk. The loop had no coverage at all: the only other test
 * that reaches it stubs `scanTasksDirectory` to an empty array, so nothing
 * asserted what a registered task actually looks like.
 *
 * Nothing is mocked here — task files are parsed (never executed) by magicast,
 * so a fixture only needs to *look* like a task file.
 */

const moduleOptions: any = { experimental: { tasks: true } }

function makeNuxt(serverDir: string) {
    return { options: { dev: false, buildDir: '/build', serverDir } }
}

/** Fresh nitroConfig shaped the way Nuxt hands it over: handlers is an array. */
function makeNitroConfig(): any {
    return { handlers: [] as any[] }
}

function taskFile(name: string, schedule: string | null, description = 'A task') {
    const scheduleLine = schedule === null
        ? '    schedule: someComputedValue,'
        : `    schedule: '${schedule}',`

    return [
        `import { defineTaskHandler } from 'nuxt-task/handler'`,
        ``,
        `export default defineTaskHandler({`,
        `    meta: {`,
        `        name: '${name}',`,
        `        description: '${description}',`,
        `    },`,
        scheduleLine,
        `    async handler() {`,
        `        return { ok: true }`,
        `    },`,
        `})`,
        ``,
    ].join('\n')
}

describe('configureNitroTasks', () => {
    let dir: string
    let tasksDir: string
    let logSpy: any
    let warnSpy: any

    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), 'nuxt-task-cnt-'))
        tasksDir = join(dir, 'tasks')
        await mkdir(tasksDir, { recursive: true })

        logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
        warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    })

    afterEach(async () => {
        logSpy.mockRestore()
        warnSpy.mockRestore()
        await rm(dir, { recursive: true, force: true })
    })

    describe('task registration', () => {
        it('registers each scanned task with its path as the handler', async () => {
            await writeFile(join(tasksDir, 'cleanup.ts'), taskFile('cleanup', '0 3 * * *', 'Nightly cleanup'))

            const cfg = makeNitroConfig()
            await configureNitroTasks(moduleOptions, cfg, makeNuxt(dir))

            expect(cfg.tasks).toEqual({
                cleanup: {
                    name: 'cleanup',
                    description: 'Nightly cleanup',
                    handler: join(tasksDir, 'cleanup.ts'),
                },
            })
        })

        it('derives nested task names from the file path', async () => {
            await mkdir(join(tasksDir, 'db'), { recursive: true })
            await writeFile(join(tasksDir, 'db', 'migrate.ts'), taskFile('migrate', '0 0 * * *'))

            const cfg = makeNitroConfig()
            await configureNitroTasks(moduleOptions, cfg, makeNuxt(dir))

            expect(Object.keys(cfg.tasks)).toEqual(['db:migrate'])
        })

        it('does nothing when experimental.tasks is not enabled', async () => {
            const cfg = makeNitroConfig()
            await configureNitroTasks({ experimental: { tasks: false } } as any, cfg, makeNuxt(dir))

            expect(cfg.tasks).toBeUndefined()
        })
    })

    describe('scheduled task grouping', () => {
        it('collapses tasks sharing a cron expression into one group', async () => {
            await writeFile(join(tasksDir, 'alpha.ts'), taskFile('alpha', '*/5 * * * *'))
            await writeFile(join(tasksDir, 'beta.ts'), taskFile('beta', '*/5 * * * *'))

            const cfg = makeNitroConfig()
            await configureNitroTasks(moduleOptions, cfg, makeNuxt(dir))

            expect(Object.keys(cfg.scheduledTasks)).toEqual(['*/5 * * * *'])
            expect([...cfg.scheduledTasks['*/5 * * * *']].sort()).toEqual(['alpha', 'beta'])
        })

        it('keeps distinct cron expressions in separate groups', async () => {
            await writeFile(join(tasksDir, 'alpha.ts'), taskFile('alpha', '*/5 * * * *'))
            await writeFile(join(tasksDir, 'beta.ts'), taskFile('beta', '0 0 * * *'))

            const cfg = makeNitroConfig()
            await configureNitroTasks(moduleOptions, cfg, makeNuxt(dir))

            expect(Object.keys(cfg.scheduledTasks).sort()).toEqual(['*/5 * * * *', '0 0 * * *'])
        })

        it('registers a task with no static schedule but does not schedule it', async () => {
            await writeFile(join(tasksDir, 'ondemand.ts'), taskFile('ondemand', null))

            const cfg = makeNitroConfig()
            await configureNitroTasks(moduleOptions, cfg, makeNuxt(dir))

            expect(Object.keys(cfg.tasks)).toEqual(['ondemand'])
            expect(cfg.scheduledTasks).toEqual({})
        })
    })

    describe('HTTP handler registration (removed)', () => {
        // These registrations were dead: they string-keyed `nitroConfig.handlers`,
        // which Nitro consumes as an array, so they were never served. Had they
        // worked they would have been unauthenticated POST triggers for every
        // task in the tree. They must stay gone.
        it('leaves nitroConfig.handlers untouched', async () => {
            await writeFile(join(tasksDir, 'cleanup.ts'), taskFile('cleanup', '0 3 * * *'))

            const cfg = makeNitroConfig()
            await configureNitroTasks(moduleOptions, cfg, makeNuxt(dir))

            expect(cfg.handlers).toEqual([])
        })

        it('does not add any /_nitro/tasks route', async () => {
            await writeFile(join(tasksDir, 'cleanup.ts'), taskFile('cleanup', '0 3 * * *'))

            const cfg = makeNitroConfig()
            await configureNitroTasks(moduleOptions, cfg, makeNuxt(dir))

            const serialised = JSON.stringify(cfg)
            expect(serialised).not.toContain('_nitro/tasks')
        })

        it('does not replace an existing handlers array', async () => {
            await writeFile(join(tasksDir, 'cleanup.ts'), taskFile('cleanup', '0 3 * * *'))

            const existing = { route: '/api/health', handler: '/srv/health.ts' }
            const cfg = { handlers: [existing] }
            await configureNitroTasks(moduleOptions, cfg as any, makeNuxt(dir))

            expect(cfg.handlers).toEqual([existing])
        })
    })

    describe('duplicate task names', () => {
        // foo.ts and foo.js both derive the name "foo". Registration was
        // last-write-wins, but the scheduled group still received both, so the
        // surviving handler ran twice concurrently on every fire.
        it('registers a duplicated name only once', async () => {
            await writeFile(join(tasksDir, 'dupe.ts'), taskFile('dupe', '*/5 * * * *'))
            await writeFile(join(tasksDir, 'dupe.js'), taskFile('dupe', '*/5 * * * *'))

            const cfg = makeNitroConfig()
            await configureNitroTasks(moduleOptions, cfg, makeNuxt(dir))

            expect(Object.keys(cfg.tasks)).toEqual(['dupe'])
        })

        it('schedules a duplicated name only once', async () => {
            await writeFile(join(tasksDir, 'dupe.ts'), taskFile('dupe', '*/5 * * * *'))
            await writeFile(join(tasksDir, 'dupe.js'), taskFile('dupe', '*/5 * * * *'))

            const cfg = makeNitroConfig()
            await configureNitroTasks(moduleOptions, cfg, makeNuxt(dir))

            expect(cfg.scheduledTasks['*/5 * * * *']).toEqual(['dupe'])
        })

        it('warns naming both conflicting files', async () => {
            await writeFile(join(tasksDir, 'dupe.ts'), taskFile('dupe', '*/5 * * * *'))
            await writeFile(join(tasksDir, 'dupe.js'), taskFile('dupe', '*/5 * * * *'))

            const cfg = makeNitroConfig()
            await configureNitroTasks(moduleOptions, cfg, makeNuxt(dir))

            const warned = warnSpy.mock.calls.map((c: any[]) => c.join(' ')).join('\n')
            expect(warned).toContain('dupe')
            expect(warned).toContain('dupe.ts')
            expect(warned).toContain('dupe.js')
        })

        it('picks the winner deterministically', async () => {
            await writeFile(join(tasksDir, 'dupe.ts'), taskFile('dupe', '*/5 * * * *'))
            await writeFile(join(tasksDir, 'dupe.js'), taskFile('dupe', '*/5 * * * *'))

            const first = makeNitroConfig()
            await configureNitroTasks(moduleOptions, first, makeNuxt(dir))
            const second = makeNitroConfig()
            await configureNitroTasks(moduleOptions, second, makeNuxt(dir))

            expect(first.tasks.dupe.handler).toBe(second.tasks.dupe.handler)
        })

        it('still registers unrelated tasks alongside a duplicate', async () => {
            await writeFile(join(tasksDir, 'dupe.ts'), taskFile('dupe', '*/5 * * * *'))
            await writeFile(join(tasksDir, 'dupe.js'), taskFile('dupe', '*/5 * * * *'))
            await writeFile(join(tasksDir, 'other.ts'), taskFile('other', '0 0 * * *'))

            const cfg = makeNitroConfig()
            await configureNitroTasks(moduleOptions, cfg, makeNuxt(dir))

            expect(Object.keys(cfg.tasks).sort()).toEqual(['dupe', 'other'])
        })
    })

    describe('build-time schedule validation', () => {
        // Warn only, never throw: a throw inside configureNitroTasks is caught
        // by its own handler and silently disables every task in the tree.
        it('warns about a schedule that can never fire', async () => {
            await writeFile(join(tasksDir, 'never.ts'), taskFile('never', '0 0 30 2 *'))

            const cfg = makeNitroConfig()
            await configureNitroTasks(moduleOptions, cfg, makeNuxt(dir))

            const warned = warnSpy.mock.calls.map((c: any[]) => c.join(' ')).join('\n')
            expect(warned).toContain('never')
            expect(warned.toLowerCase()).toContain('never run')
        })

        it('warns about a schedule Nitro cannot parse', async () => {
            await writeFile(join(tasksDir, 'bogus.ts'), taskFile('bogus', 'not a cron at all'))

            const cfg = makeNitroConfig()
            await configureNitroTasks(moduleOptions, cfg, makeNuxt(dir))

            const warned = warnSpy.mock.calls.map((c: any[]) => c.join(' ')).join('\n')
            expect(warned).toContain('bogus')
        })

        it('still registers a task with an unsatisfiable schedule', async () => {
            await writeFile(join(tasksDir, 'never.ts'), taskFile('never', '0 0 30 2 *'))

            const cfg = makeNitroConfig()
            await configureNitroTasks(moduleOptions, cfg, makeNuxt(dir))

            // Warn, don't drop. The task is still reachable on demand.
            expect(Object.keys(cfg.tasks)).toEqual(['never'])
        })

        it('does not warn about schedules croner accepts that the module parser rejects', async () => {
            await writeFile(join(tasksDir, 'sunday.ts'), taskFile('sunday', '0 0 * * 7'))
            await writeFile(join(tasksDir, 'nickname.ts'), taskFile('nickname', '@daily'))

            const cfg = makeNitroConfig()
            await configureNitroTasks(moduleOptions, cfg, makeNuxt(dir))

            const warned = warnSpy.mock.calls.map((c: any[]) => c.join(' ')).join('\n')
            expect(warned).not.toContain('sunday')
            expect(warned).not.toContain('nickname')
        })

        it('does not warn about ordinary valid schedules', async () => {
            await writeFile(join(tasksDir, 'fine.ts'), taskFile('fine', '*/5 * * * *'))

            const cfg = makeNitroConfig()
            await configureNitroTasks(moduleOptions, cfg, makeNuxt(dir))

            const warned = warnSpy.mock.calls.map((c: any[]) => c.join(' ')).join('\n')
            expect(warned).not.toContain('fine')
        })
    })
})
