import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { join } from 'pathe'
import type { Dirent } from 'fs'
import { scanTasksDirectory, parseTaskName } from './../../../src/runtime/server/nitro/utils/scanTasks'
import { readdir } from 'fs/promises'



// Mock the fs/promises module
vi.mock('fs/promises', () => ({
    readdir: vi.fn(),
}))

describe('Nitro Tasks Scanner', () => {
    const mockBaseDir = '/mock/server/tasks'

    // Helper to create mock Dirent objects
    const createMockDirent = (name: string, isDir = false): Dirent => ({
        name,
        isDirectory: () => isDir,
        isFile: () => !isDir,
        isBlockDevice: () => false,
        isCharacterDevice: () => false,
        isFIFO: () => false,
        isSocket: () => false,
        isSymbolicLink: () => false,
    } as Dirent)

    describe('parseTaskName', () => {
        const testCases = [
            {
                input: 'simple.ts',
                expected: 'simple',
                description: 'root level file'
            },
            {
                input: 'test/db/migrate.ts',
                expected: 'test:db:migrate',
                description: 'nested database migration'
            },
            {
                input: 'test/example.ts',
                expected: 'test:example',
                description: 'single nested file'
            },
            {
                input: 'example/index.ts',
                expected: 'example:index',
                description: 'index file in directory'
            },
            {
                input: 'deeply/nested/path/task.js',
                expected: 'deeply:nested:path:task',
                description: 'deeply nested file'
            },
            {
                input: 'db/migrate.ts',
                expected: 'db:migrate',
                description: 'standard db migration path'
            },
            {
                input: 'example.ts',
                expected: 'example',
                description: 'single file at root'
            },
            {
                input: 'api/endpoints/users/list.ts',
                expected: 'api:endpoints:users:list',
                description: 'api endpoint structure'
            }
        ]

        testCases.forEach(({ input, expected, description }) => {
            it(`should correctly parse ${description}`, () => {
                const result = parseTaskName(input)
                expect(result).toBe(expected)
            })
        })

        // Edge cases
        it('should handle consecutive slashes', () => {
            expect(parseTaskName('api//users///list.ts')).toBe('api:users:list')
        })

        it('should handle leading/trailing slashes', () => {
            expect(parseTaskName('/api/users/list.ts')).toBe('api:users:list')
            expect(parseTaskName('api/users/list.ts/')).toBe('api:users:list')
        })

        it('should handle mixed path separators', () => {
            expect(parseTaskName('api\\users/list.ts')).toBe('api:users:list')
            expect(parseTaskName('api/users\\list.ts')).toBe('api:users:list')
        })

        it('should handle dots in directory names', () => {
            expect(parseTaskName('v1.0/api/list.ts')).toBe('v1.0:api:list')
        })

        it('should preserve dots in task names', () => {
            expect(parseTaskName('api/v1.0.ts')).toBe('api:v1.0')
        })

        it('should handle empty segments', () => {
            expect(parseTaskName('api//list.ts')).toBe('api:list')
            expect(parseTaskName('/api/list.ts')).toBe('api:list')
            expect(parseTaskName('api/list.ts/')).toBe('api:list')
        })
    })

    describe('scanTasksDirectory', () => {
        beforeEach(() => {
            vi.resetAllMocks()
            // Reset console.warn mock before each test
            vi.spyOn(console, 'warn').mockImplementation(() => {})
        })

        afterEach(() => {
            vi.restoreAllMocks()
        })

        it('should scan a simple directory with no nested folders', async () => {
            const mockFiles = [
                createMockDirent('task1.ts'),
                createMockDirent('task2.js'),
                createMockDirent('ignore.txt')
            ]

            vi.mocked(readdir).mockResolvedValueOnce(mockFiles)

            const tasks = await scanTasksDirectory(mockBaseDir)

            expect(tasks).toHaveLength(2)
            expect(tasks).toContainEqual({
                name: 'task1',
                path: join(mockBaseDir, 'task1.ts')
            })
            expect(tasks).toContainEqual({
                name: 'task2',
                path: join(mockBaseDir, 'task2.js')
            })
        })

        it('should scan nested directories', async () => {
            // Mock root directory
            const mockRootFiles = [
                createMockDirent('root.ts'),
                createMockDirent('nested', true)
            ]

            // Mock nested directory
            const mockNestedFiles = [
                createMockDirent('nested-task.ts')
            ]

            vi.mocked(readdir)
                .mockResolvedValueOnce(mockRootFiles)
                .mockResolvedValueOnce(mockNestedFiles)

            const tasks = await scanTasksDirectory(mockBaseDir)

            expect(tasks).toHaveLength(2)
            expect(tasks).toContainEqual({
                name: 'root',
                path: join(mockBaseDir, 'root.ts')
            })
            expect(tasks).toContainEqual({
                name: 'nested:nested-task',
                path: join(mockBaseDir, 'nested', 'nested-task.ts')
            })
        })

        it('should handle deeply nested directories', async () => {
            const mockRootFiles = [
                createMockDirent('db', true),
                createMockDirent('cron', true)
            ]

            const mockDbDir = [
                createMockDirent('migrations', true)
            ]

            const mockMigrationsDir = [
                createMockDirent('init.ts')
            ]

            const mockCronDir = [
                createMockDirent('jobs', true)
            ]

            const mockJobsDir = [
                createMockDirent('cleanup.ts')
            ]

            vi.mocked(readdir)
                .mockResolvedValueOnce(mockRootFiles)
                .mockResolvedValueOnce(mockDbDir)
                .mockResolvedValueOnce(mockMigrationsDir)
                .mockResolvedValueOnce(mockCronDir)
                .mockResolvedValueOnce(mockJobsDir)

            const tasks = await scanTasksDirectory(mockBaseDir)

            expect(tasks).toHaveLength(2)
            expect(tasks).toContainEqual({
                name: 'db:migrations:init',
                path: join(mockBaseDir, 'db', 'migrations', 'init.ts')
            })
            expect(tasks).toContainEqual({
                name: 'cron:jobs:cleanup',
                path: join(mockBaseDir, 'cron', 'jobs', 'cleanup.ts')
            })
        })

        it('should handle errors gracefully', async () => {
            const warnSpy = vi.spyOn(console, 'warn')
            vi.mocked(readdir).mockRejectedValue(new Error('Access denied'))

            const tasks = await scanTasksDirectory(mockBaseDir)
            
            expect(tasks).toHaveLength(0)
            expect(warnSpy).toHaveBeenCalledWith(
                'Failed to scan directory /mock/server/tasks:',
                expect.objectContaining({ message: 'Access denied' })
            )
        })

        it('should ignore non-ts/js files', async () => {
            const mockFiles = [
                createMockDirent('task.ts'),
                createMockDirent('task.js'),
                createMockDirent('readme.md'),
                createMockDirent('.gitignore'),
                createMockDirent('task.json')
            ]

            vi.mocked(readdir).mockResolvedValueOnce(mockFiles)

            const tasks = await scanTasksDirectory(mockBaseDir)

            expect(tasks).toHaveLength(2)
            expect(tasks.every(task => 
                task.path.endsWith('.ts') || task.path.endsWith('.js')
            )).toBe(true)
        })
    })
})