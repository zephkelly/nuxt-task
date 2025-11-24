import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { parseTaskName, scanTasksDirectory } from '../../../src/runtime/utils/scanTasks'
import { readdir } from 'node:fs/promises'
import { join } from 'pathe'


vi.mock('node:fs/promises')

describe('scanTasks', () => {
    describe('parseTaskName', () => {
        it('should convert simple path to task name', () => {
            expect(parseTaskName('task.ts')).toBe('task')
            expect(parseTaskName('task.js')).toBe('task')
        })

        it('should convert nested paths to colon-separated names', () => {
            expect(parseTaskName('users/sync.ts')).toBe('users:sync')
            expect(parseTaskName('admin/users/cleanup.ts')).toBe('admin:users:cleanup')
        })

        it('should handle leading and trailing slashes', () => {
            expect(parseTaskName('/tasks/sync.ts')).toBe('tasks:sync')
            expect(parseTaskName('tasks/sync.ts/')).toBe('tasks:sync')
            expect(parseTaskName('/tasks/sync.ts/')).toBe('tasks:sync')
        })

        it('should handle multiple consecutive slashes', () => {
            expect(parseTaskName('tasks//sync.ts')).toBe('tasks:sync')
            expect(parseTaskName('tasks///nested//sync.ts')).toBe('tasks:nested:sync')
        })

        it('should handle Windows-style backslashes', () => {
            expect(parseTaskName('tasks\\sync.ts')).toBe('tasks:sync')
            expect(parseTaskName('tasks\\nested\\sync.ts')).toBe('tasks:nested:sync')
        })

        it('should remove file extensions', () => {
            expect(parseTaskName('task.ts')).toBe('task')
            expect(parseTaskName('task.js')).toBe('task')
            expect(parseTaskName('task.mjs')).toBe('task')
            expect(parseTaskName('nested/task.tsx')).toBe('nested:task')
        })

        it('should handle paths with dots in folder names', () => {
            expect(parseTaskName('v1.0/task.ts')).toBe('v1.0:task')
            expect(parseTaskName('folder.name/sub.folder/task.ts')).toBe('folder.name:sub.folder:task')
        })

        it('should handle empty path', () => {
            expect(parseTaskName('')).toBe('')
        })
    })

    describe('scanTasksDirectory', () => {
        const mockBaseDir = '/test/tasks'

        beforeEach(() => {
            vi.clearAllMocks()
        })

        afterEach(() => {
            vi.restoreAllMocks()
        })

        it('should scan directory and find TypeScript files', async () => {
            vi.mocked(readdir).mockResolvedValueOnce([
                { name: 'task1.ts', isFile: () => true, isDirectory: () => false } as any,
                { name: 'task2.ts', isFile: () => true, isDirectory: () => false } as any,
            ])

            const tasks = await scanTasksDirectory(mockBaseDir)

            expect(tasks).toHaveLength(2)
            expect(tasks[0].name).toBe('task1')
            expect(tasks[0].path).toBe(join(mockBaseDir, 'task1.ts'))
            expect(tasks[1].name).toBe('task2')
            expect(tasks[1].path).toBe(join(mockBaseDir, 'task2.ts'))
        })

        it('should scan directory and find JavaScript files', async () => {
            vi.mocked(readdir).mockResolvedValueOnce([
                { name: 'task1.js', isFile: () => true, isDirectory: () => false } as any,
                { name: 'task2.js', isFile: () => true, isDirectory: () => false } as any,
            ])

            const tasks = await scanTasksDirectory(mockBaseDir)

            expect(tasks).toHaveLength(2)
            expect(tasks[0].name).toBe('task1')
            expect(tasks[1].name).toBe('task2')
        })

        it('should scan nested directories recursively', async () => {
            vi.mocked(readdir)
                .mockResolvedValueOnce([
                    { name: 'root-task.ts', isFile: () => true, isDirectory: () => false } as any,
                    { name: 'nested', isFile: () => false, isDirectory: () => true } as any,
                ])
                .mockResolvedValueOnce([
                    { name: 'nested-task.ts', isFile: () => true, isDirectory: () => false } as any,
                ])

            const tasks = await scanTasksDirectory(mockBaseDir)

            expect(tasks).toHaveLength(2)
            expect(tasks[0].name).toBe('root-task')
            expect(tasks[1].name).toBe('nested:nested-task')
        })

        it('should ignore non-JS/TS files', async () => {
            vi.mocked(readdir).mockResolvedValueOnce([
                { name: 'task.ts', isFile: () => true, isDirectory: () => false } as any,
                { name: 'readme.md', isFile: () => true, isDirectory: () => false } as any,
                { name: 'config.json', isFile: () => true, isDirectory: () => false } as any,
                { name: 'task.txt', isFile: () => true, isDirectory: () => false } as any,
            ])

            const tasks = await scanTasksDirectory(mockBaseDir)

            expect(tasks).toHaveLength(1)
            expect(tasks[0].name).toBe('task')
        })

        it('should handle deeply nested directories', async () => {
            vi.mocked(readdir)
                .mockResolvedValueOnce([
                    { name: 'level1', isFile: () => false, isDirectory: () => true } as any,
                ])
                .mockResolvedValueOnce([
                    { name: 'level2', isFile: () => false, isDirectory: () => true } as any,
                ])
                .mockResolvedValueOnce([
                    { name: 'deep-task.ts', isFile: () => true, isDirectory: () => false } as any,
                ])

            const tasks = await scanTasksDirectory(mockBaseDir)

            expect(tasks).toHaveLength(1)
            expect(tasks[0].name).toBe('level1:level2:deep-task')
        })

        it('should handle empty directories', async () => {
            vi.mocked(readdir).mockResolvedValueOnce([])

            const tasks = await scanTasksDirectory(mockBaseDir)

            expect(tasks).toHaveLength(0)
        })

        it('should handle directory scan errors', async () => {
            const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => { })

            vi.mocked(readdir).mockRejectedValueOnce(new Error('Permission denied'))

            const tasks = await scanTasksDirectory(mockBaseDir)

            expect(tasks).toHaveLength(0)
            expect(consoleWarnSpy).toHaveBeenCalledWith(
                expect.stringContaining(`Failed to scan directory ${mockBaseDir}`),
                expect.any(Error)
            )

            consoleWarnSpy.mockRestore()
        })

        it('should handle mixed files and directories', async () => {
            vi.mocked(readdir)
                .mockResolvedValueOnce([
                    { name: 'task1.ts', isFile: () => true, isDirectory: () => false } as any,
                    { name: 'folder1', isFile: () => false, isDirectory: () => true } as any,
                    { name: 'task2.js', isFile: () => true, isDirectory: () => false } as any,
                    { name: 'folder2', isFile: () => false, isDirectory: () => true } as any,
                ])
                .mockResolvedValueOnce([
                    { name: 'nested1.ts', isFile: () => true, isDirectory: () => false } as any,
                ])
                .mockResolvedValueOnce([
                    { name: 'nested2.js', isFile: () => true, isDirectory: () => false } as any,
                ])

            const tasks = await scanTasksDirectory(mockBaseDir)

            expect(tasks).toHaveLength(4)
            expect(tasks.map(t => t.name)).toEqual([
                'task1',
                'folder1:nested1',
                'task2',
                'folder2:nested2',
            ])
        })
    })
})