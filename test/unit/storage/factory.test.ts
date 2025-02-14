import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import {
    type StorageConfig,
    createServerStorage,
    createClientStorage
} from '../../../src/runtime/storage'



class MockStorage implements Storage {
    private items: Record<string, string> = {}

    get length() {
        return Object.keys(this.items).length
    }

    clear(): void {
        this.items = {}
    }

    getItem(key: string): string | null {
        return this.items[key] || null
    }

    key(index: number): string | null {
        return Object.keys(this.items)[index] || null
    }

    removeItem(key: string): void {
        delete this.items[key]
    }

    setItem(key: string, value: string): void {
        this.items[key] = value
    }
}

const mockLocalStorage = new MockStorage()
const mockSessionStorage = new MockStorage()

vi.stubGlobal('localStorage', mockLocalStorage)
vi.stubGlobal('sessionStorage', mockSessionStorage)

const createTestTask = () => ({
    name: 'Test Task',
    status: 'pending' as const,
    options: {
        expression: '* * * * *',
        timeout: 1000,
    },
    execute: async () => 'test result',
    metadata: {
        runCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
    },
})

// Mock the memory storage module
vi.mock('../../../src/runtime/storage/environments/memory', () => ({
    createMemoryStorage: vi.fn(() => Promise.resolve({
        type: 'memory' as const,
        init: vi.fn(),
    })),
    MemoryStorage: vi.fn().mockImplementation(() => ({
        type: 'memory' as const,
        init: vi.fn(),
    })),
}))

describe('Storage Factory', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mockLocalStorage.clear()
        mockSessionStorage.clear()
    })

    afterEach(() => {
        vi.resetModules()
    })

    describe('Server Storage Factory', () => {
        it('should create memory storage', async () => {
            const config: StorageConfig = { type: 'memory' }
            const storage = await createServerStorage(config)
            expect(storage).toHaveProperty('type', 'memory')
        })

        it('should throw error for unsupported storage types', async () => {
            const config: StorageConfig = {
                type: 'localStorage',
                config: { prefix: 'test:' },
            }

            await expect(async () => {
                await createServerStorage(config)
            }).rejects.toThrow('Storage type localStorage is not supported in server environment')
        })
    })

    describe('Browser Storage Factory', () => {
        it('should create memory storage', async () => {
            const config: StorageConfig = { type: 'memory' }
            const storage = await createClientStorage(config)
            expect(storage).toHaveProperty('type', 'memory')
        })

        it('should create localStorage with config', async () => {
            const config: StorageConfig = {
                type: 'localStorage',
                config: { prefix: 'test:' },
            }

            const storage = await createClientStorage(config)
            expect(storage).toBeDefined()

            const testTask = createTestTask()
            const storedTask = await storage.add(testTask)

            const keys = Array.from({ length: mockLocalStorage.length }, (_, i) =>
                mockLocalStorage.key(i)!,
            )
            const key = keys.find(k => k.startsWith('test:') && k.includes(storedTask.id))
            expect(key).toBeDefined()

            const storedData = mockLocalStorage.getItem(key!)
            expect(storedData).toBeDefined()
            const parsedTask = JSON.parse(storedData!)
            expect(parsedTask.name).toBe(testTask.name)
            expect(parsedTask.status).toBe(testTask.status)
            expect(parsedTask.metadata.runCount).toBe(0)
        })

        it('should create sessionStorage with config', async () => {
            const config: StorageConfig = {
                type: 'sessionStorage',
                config: { prefix: 'test:' },
            }

            const storage = await createClientStorage(config)
            expect(storage).toBeDefined()

            const testTask = createTestTask()
            const storedTask = await storage.add(testTask)

            const keys = Array.from({ length: mockSessionStorage.length }, (_, i) =>
                mockSessionStorage.key(i)!,
            )
            const key = keys.find(k => k.startsWith('test:') && k.includes(storedTask.id))
            expect(key).toBeDefined()

            const storedData = mockSessionStorage.getItem(key!)
            expect(storedData).toBeDefined()
            const parsedTask = JSON.parse(storedData!)
            expect(parsedTask.name).toBe(testTask.name)
            expect(parsedTask.status).toBe(testTask.status)
            expect(parsedTask.metadata.runCount).toBe(0)
        })
    })

    describe('Edge Cases', () => {
        it('should handle missing config for browser storage', async () => {
            const config: StorageConfig = {
                type: 'localStorage',
            }

            const storage = await createClientStorage(config)
            expect(storage).toBeDefined()

            const testTask = createTestTask()
            const storedTask = await storage.add(testTask)

            const keys = Array.from({ length: mockLocalStorage.length }, (_, i) =>
                mockLocalStorage.key(i)!,
            )
            const key = keys.find(k => k.startsWith('cron:') && k.includes(storedTask.id))
            expect(key).toBeDefined()
            expect(key).toContain(storedTask.id)
        })
    })
})
