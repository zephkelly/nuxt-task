import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { generateVirtualTasksModule } from '../../../src/module'
import { scanTasksDirectory } from '../../../src/runtime/utils/scanTasks'

// vitest hoists vi.mock above the imports above.
vi.mock('../../../src/runtime/utils/scanTasks', () => ({
    scanTasksDirectory: vi.fn(),
}))

const mockedScan = vi.mocked(scanTasksDirectory)

describe('generateVirtualTasksModule', () => {
    let logSpy: any

    beforeEach(() => {
        vi.clearAllMocks()
        logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    })

    afterEach(() => {
        logSpy.mockRestore()
    })

    it('produces an empty taskDefinitions array when there are no tasks', async () => {
        mockedScan.mockResolvedValue([])

        const code = await generateVirtualTasksModule('/srv/tasks')

        expect(code).toContain('export const taskDefinitions = [];')
        expect(code).not.toContain('import ')
    })

    it('statically imports each task by absolute path and lists them', async () => {
        mockedScan.mockResolvedValue([
            { name: 'example', path: '/srv/tasks/example.ts' },
            { name: 'db:migrate', path: '/srv/tasks/db/migrate.ts' },
        ])

        const code = await generateVirtualTasksModule('/srv/tasks')

        expect(code).toContain('import task_0 from "/srv/tasks/example.ts";')
        expect(code).toContain('import task_1 from "/srv/tasks/db/migrate.ts";')
        expect(code).toContain('export const taskDefinitions = [task_0, task_1];')
    })

    it('JSON.stringify-quotes paths so special characters are safe', async () => {
        mockedScan.mockResolvedValue([
            { name: 'weird', path: '/srv/tasks/a "b".ts' },
        ])

        const code = await generateVirtualTasksModule('/srv/tasks')

        // The embedded quotes/backslashes must be escaped, not break the module.
        expect(code).toContain('import task_0 from "/srv/tasks/a \\"b\\".ts";')
    })

    it('does not re-join the scanned (already absolute) path', async () => {
        mockedScan.mockResolvedValue([
            { name: 'example', path: '/abs/server/tasks/example.ts' },
        ])

        const code = await generateVirtualTasksModule('/abs/server/tasks')

        // Regression guard for the old doubled-path bug
        // (join(tasksDir, absolutePath) -> /abs/server/tasks/abs/server/tasks/...).
        expect(code).toContain('"/abs/server/tasks/example.ts"')
        expect(code).not.toContain('/abs/server/tasks/abs/server/tasks/')
    })
})
