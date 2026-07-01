import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { join } from 'pathe'
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { extractTaskMeta, extractTaskMetas } from '../../../src/runtime/utils/extractTaskMeta'

describe('extractTaskMeta', () => {
    let tasksDir: string

    async function writeTask(name: string, content: string) {
        const path = join(tasksDir, name)
        await writeFile(path, content, 'utf-8')
        return { name: name.replace(/\.[^/.]+$/, ''), path }
    }

    beforeEach(async () => {
        tasksDir = await mkdtemp(join(tmpdir(), 'nuxt-task-extract-'))
    })

    afterEach(async () => {
        if (tasksDir) {
            await rm(tasksDir, { recursive: true, force: true })
        }
    })

    it('extracts a literal schedule and description', async () => {
        const task = await writeTask('simple.ts', `
import { defineTaskHandler } from 'nuxt-task/handler'

export default defineTaskHandler({
    meta: { name: 'simple', description: 'A simple task' },
    schedule: '*/5 * * * *',
    async handler() { return {} },
})
        `)

        const info = await extractTaskMeta(task)

        expect(info).not.toBeNull()
        expect(info?.schedule).toBe('*/5 * * * *')
        expect(info?.description).toBe('A simple task')
        expect(info?.path).toBe(task.path)
    })

    // The core regression: a task with aliased + relative + auto-imported
    // dependencies must still yield its literal schedule, because parsing
    // never resolves imports.
    it('extracts schedule from a task using aliased/relative/auto imports', async () => {
        const task = await writeTask('reminders.ts', `
import { getPg } from '~/server/utils/db'
import { formatReminder } from '../utils/format'
import { defineTaskHandler } from 'nuxt-task/handler'

export default defineTaskHandler({
    meta: { name: 'reminders', description: 'Send reminders' },
    schedule: '30 9 * * *',
    async handler() {
        // sendAlert() is an auto-import with no explicit import statement
        const rows = await getPg().query('select 1')
        return { sent: sendAlert(formatReminder(rows)) }
    },
})
        `)

        const info = await extractTaskMeta(task)

        expect(info).not.toBeNull()
        expect(info?.schedule).toBe('30 9 * * *')
        expect(info?.description).toBe('Send reminders')
    })

    it('treats a computed (non-literal) schedule as on-demand and warns', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

        const task = await writeTask('computed.ts', `
import { defineTaskHandler } from 'nuxt-task/handler'

const EVERY_MINUTE = '* * * * *'

export default defineTaskHandler({
    meta: { name: 'computed', description: 'Computed schedule' },
    schedule: EVERY_MINUTE,
    async handler() { return {} },
})
        `)

        const info = await extractTaskMeta(task)

        expect(info).not.toBeNull()
        expect(info?.schedule).toBeUndefined()
        expect(info?.description).toBe('Computed schedule')
        expect(warn).toHaveBeenCalledWith(
            expect.stringContaining('on-demand only')
        )

        warn.mockRestore()
    })

    it('does not warn for a task that legitimately has no schedule', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

        const task = await writeTask('ondemand.ts', `
import { defineTaskHandler } from 'nuxt-task/handler'

export default defineTaskHandler({
    meta: { name: 'ondemand', description: 'On-demand only' },
    async handler() { return {} },
})
        `)

        const info = await extractTaskMeta(task)

        expect(info).not.toBeNull()
        expect(info?.schedule).toBeUndefined()
        expect(warn).not.toHaveBeenCalled()

        warn.mockRestore()
    })

    it('returns null and warns when meta is missing', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

        const task = await writeTask('no-meta.ts', `
import { defineTaskHandler } from 'nuxt-task/handler'

export default defineTaskHandler({
    schedule: '* * * * *',
    async handler() { return {} },
})
        `)

        const info = await extractTaskMeta(task)

        expect(info).toBeNull()
        expect(warn).toHaveBeenCalledWith(
            expect.stringContaining('invalid format')
        )

        warn.mockRestore()
    })

    it('defaults description to an empty string when omitted', async () => {
        const task = await writeTask('no-desc.ts', `
import { defineTaskHandler } from 'nuxt-task/handler'

export default defineTaskHandler({
    meta: { name: 'no-desc' },
    schedule: '* * * * *',
    async handler() { return {} },
})
        `)

        const info = await extractTaskMeta(task)

        expect(info).not.toBeNull()
        expect(info?.description).toBe('')
        expect(info?.schedule).toBe('* * * * *')
    })

    it('returns null when the file cannot be read', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

        const info = await extractTaskMeta({
            name: 'missing',
            path: join(tasksDir, 'does-not-exist.ts'),
        })

        expect(info).toBeNull()
        expect(warn).toHaveBeenCalledWith(
            expect.stringContaining('Failed to parse task missing'),
            expect.anything()
        )

        warn.mockRestore()
    })

    describe('extractTaskMetas', () => {
        it('collects valid tasks and drops malformed ones', async () => {
            const valid = await writeTask('valid.ts', `
import { defineTaskHandler } from 'nuxt-task/handler'
export default defineTaskHandler({
    meta: { name: 'valid', description: 'ok' },
    schedule: '0 0 * * *',
    async handler() { return {} },
})
            `)
            const invalid = await writeTask('invalid.ts', `
export default { not: 'a task' }
            `)

            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
            const metas = await extractTaskMetas([valid, invalid])
            warn.mockRestore()

            expect(metas).toHaveLength(1)
            expect(metas[0].name).toBe('valid')
            expect(metas[0].schedule).toBe('0 0 * * *')
        })

        it('handles nested task directories', async () => {
            await mkdir(join(tasksDir, 'db'), { recursive: true })
            const nested = await writeTask('db/migrate.ts', `
import { defineTaskHandler } from 'nuxt-task/handler'
export default defineTaskHandler({
    meta: { name: 'db:migrate', description: 'migrate' },
    schedule: '0 3 * * *',
    async handler() { return {} },
})
            `)

            const metas = await extractTaskMetas([
                { name: 'db:migrate', path: nested.path },
            ])

            expect(metas).toHaveLength(1)
            expect(metas[0].schedule).toBe('0 3 * * *')
            expect(metas[0].path).toBe(nested.path)
        })

        it('returns an empty array for no tasks', async () => {
            expect(await extractTaskMetas([])).toEqual([])
        })
    })
})
