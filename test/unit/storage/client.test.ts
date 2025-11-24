import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
    ClientLocalStorage,
    ClientSessionStorage,
    createClientStorage,
} from '../../../src/runtime/storage/client'
import type { CronTask } from '../../../src/runtime/task/types'

// Mock Storage implementation for testing
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
    metadata: {
        runCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
    },
    execute: async () => 'test result',
})

describe('ClientLocalStorage', () => {
    let storage: ClientLocalStorage
    let currentTime: number

    beforeEach(() => {
        currentTime = new Date('2024-01-01T00:00:00.000Z').getTime()
        vi.useFakeTimers()
        vi.setSystemTime(currentTime)
        mockLocalStorage.clear()
        storage = new ClientLocalStorage()
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    describe('constructor and init', () => {
        it('should initialize with default prefix', () => {
            const store = new ClientLocalStorage()
            expect(store['prefix']).toBe('cron:')
        })

        it('should initialize with custom prefix', () => {
            const store = new ClientLocalStorage({ prefix: 'custom:' })
            expect(store['prefix']).toBe('custom:')
        })

        it('should have async init method', async () => {
            await expect(storage.init()).resolves.toBeUndefined()
        })
    })

    describe('add', () => {
        it('should add a new task and generate id', async () => {
            const taskData = createTestTask()
            const task = await storage.add(taskData)

            expect(task).toMatchObject({
                ...taskData,
                id: expect.any(String),
                metadata: {
                    runCount: 0,
                    createdAt: new Date(currentTime),
                    updatedAt: new Date(currentTime),
                },
            })

            // Verify it's stored in localStorage
            const storedData = mockLocalStorage.getItem(`cron:${task.id}`)
            expect(storedData).toBeDefined()
            const parsed = JSON.parse(storedData!)
            expect(parsed.id).toBe(task.id)
        })

        it('should store task with all properties', async () => {
            const taskData = createTestTask()
            const task = await storage.add(taskData)

            const retrieved = await storage.get(task.id)

            // Note: execute function cannot be serialized to localStorage
            // and dates become strings after JSON round-trip
            expect(retrieved).toMatchObject({
                id: task.id,
                name: task.name,
                status: task.status,
                options: task.options,
                metadata: {
                    runCount: task.metadata.runCount,
                },
            })

            // Verify dates are present (as strings after JSON serialization)
            expect(retrieved?.metadata.createdAt).toBeDefined()
            expect(retrieved?.metadata.updatedAt).toBeDefined()
        })

        it('should handle tasks with metadata', async () => {
            const taskData = {
                ...createTestTask(),
                metadata: {
                    runCount: 5,
                    createdAt: new Date(currentTime - 1000),
                    updatedAt: new Date(currentTime - 500),
                },
            }
            const task = await storage.add(taskData)

            expect(task.metadata.runCount).toBe(5)
        })
    })

    describe('get', () => {
        it('should retrieve an existing task', async () => {
            const taskData = createTestTask()
            const addedTask = await storage.add(taskData)

            const retrieved = await storage.get(addedTask.id)

            // Compare serializable properties only
            expect(retrieved).toMatchObject({
                id: addedTask.id,
                name: addedTask.name,
                status: addedTask.status,
                options: addedTask.options,
            })
            expect(retrieved?.metadata.runCount).toBe(addedTask.metadata.runCount)
        })

        it('should return null for non-existent task', async () => {
            const result = await storage.get('non-existent-id')
            expect(result).toBeNull()
        })

        it('should return null for invalid key', async () => {
            const result = await storage.get('')
            expect(result).toBeNull()
        })
    })

    describe('getAll', () => {
        it('should return empty array when no tasks exist', async () => {
            const tasks = await storage.getAll()
            expect(tasks).toEqual([])
        })

        it('should return all tasks', async () => {
            const task1 = await storage.add({ ...createTestTask(), name: 'Task 1' })
            const task2 = await storage.add({ ...createTestTask(), name: 'Task 2' })
            const task3 = await storage.add({ ...createTestTask(), name: 'Task 3' })

            const allTasks = await storage.getAll()
            expect(allTasks).toHaveLength(3)

            // Compare by id and name only (execute function is not serialized)
            const taskNames = allTasks.map(t => t.name).sort()
            expect(taskNames).toEqual(['Task 1', 'Task 2', 'Task 3'])

            const taskIds = allTasks.map(t => t.id).sort()
            expect(taskIds).toContain(task1.id)
            expect(taskIds).toContain(task2.id)
            expect(taskIds).toContain(task3.id)
        })

        it('should only return tasks with correct prefix', async () => {
            const task = await storage.add(createTestTask())

            // Add item with different prefix
            mockLocalStorage.setItem('other:key', JSON.stringify({ name: 'Other' }))

            const allTasks = await storage.getAll()
            expect(allTasks).toHaveLength(1)
            expect(allTasks[0].id).toBe(task.id)
        })

        it('should handle storage with multiple prefixed items', async () => {
            const customStorage = new ClientLocalStorage({ prefix: 'test:' })
            const task1 = await customStorage.add(createTestTask())
            const task2 = await storage.add(createTestTask())

            const customTasks = await customStorage.getAll()
            const defaultTasks = await storage.getAll()

            expect(customTasks).toHaveLength(1)
            expect(defaultTasks).toHaveLength(1)
            expect(customTasks[0].id).toBe(task1.id)
            expect(defaultTasks[0].id).toBe(task2.id)
        })
    })

    describe('update', () => {
        it('should update existing task', async () => {
            const task = await storage.add(createTestTask())
            vi.advanceTimersByTime(1000)

            const updatedTask = await storage.update(task.id, {
                name: 'Updated Task',
                status: 'running',
            })

            expect(updatedTask.name).toBe('Updated Task')
            expect(updatedTask.status).toBe('running')
            expect(updatedTask.metadata.updatedAt.getTime()).toBeGreaterThan(
                task.metadata.updatedAt.getTime()
            )
        })

        it('should update task options', async () => {
            const task = await storage.add(createTestTask())

            const updatedTask = await storage.update(task.id, {
                options: {
                    expression: '*/5 * * * *',
                    timeout: 5000,
                },
            })

            expect(updatedTask.options.expression).toBe('*/5 * * * *')
            expect(updatedTask.options.timeout).toBe(5000)
        })

        it('should update metadata', async () => {
            const task = await storage.add(createTestTask())
            const lastRun = new Date()

            const updatedTask = await storage.update(task.id, {
                metadata: {
                    lastRun,
                    runCount: 10,
                    createdAt: task.metadata.createdAt,
                    updatedAt: new Date(),
                },
            })

            expect(updatedTask.metadata.lastRun).toEqual(lastRun)
            expect(updatedTask.metadata.runCount).toBe(10)
        })

        it('should throw error when updating non-existent task', async () => {
            await expect(
                storage.update('non-existent', { name: 'Updated' })
            ).rejects.toThrow('Task with id non-existent not found')
        })

        it('should preserve unchanged properties', async () => {
            const task = await storage.add(createTestTask())
            const originalStatus = task.status

            const updatedTask = await storage.update(task.id, {
                name: 'New Name',
            })

            expect(updatedTask.name).toBe('New Name')
            expect(updatedTask.status).toBe(originalStatus)

            // Note: execute function cannot be preserved through localStorage serialization
            // This is a known limitation of browser storage
        })
    })

    describe('remove', () => {
        it('should remove existing task', async () => {
            const task = await storage.add(createTestTask())

            const result = await storage.remove(task.id)
            expect(result).toBe(true)

            const retrieved = await storage.get(task.id)
            expect(retrieved).toBeNull()
        })

        it('should return false when removing non-existent task', async () => {
            const result = await storage.remove('non-existent')
            expect(result).toBe(false)
        })

        it('should remove correct task from storage', async () => {
            const task1 = await storage.add({ ...createTestTask(), name: 'Task 1' })
            const task2 = await storage.add({ ...createTestTask(), name: 'Task 2' })

            await storage.remove(task1.id)

            const allTasks = await storage.getAll()
            expect(allTasks).toHaveLength(1)
            expect(allTasks[0].id).toBe(task2.id)
        })
    })

    describe('clear', () => {
        it('should remove all tasks', async () => {
            await storage.add({ ...createTestTask(), name: 'Task 1' })
            await storage.add({ ...createTestTask(), name: 'Task 2' })
            await storage.add({ ...createTestTask(), name: 'Task 3' })

            await storage.clear()

            const allTasks = await storage.getAll()
            expect(allTasks).toHaveLength(0)
        })

        it('should only clear tasks with correct prefix', async () => {
            await storage.add(createTestTask())
            mockLocalStorage.setItem('other:key', JSON.stringify({ name: 'Other' }))

            await storage.clear()

            expect(mockLocalStorage.getItem('other:key')).toBeDefined()
            const allTasks = await storage.getAll()
            expect(allTasks).toHaveLength(0)
        })

        it('should work when storage is already empty', async () => {
            await expect(storage.clear()).resolves.toBeUndefined()
            const allTasks = await storage.getAll()
            expect(allTasks).toHaveLength(0)
        })

        it('should handle storage with multiple items', async () => {
            // Add tasks with default prefix
            await storage.add({ ...createTestTask(), name: 'Task 1' })
            await storage.add({ ...createTestTask(), name: 'Task 2' })

            // Add tasks with custom prefix
            const customStorage = new ClientLocalStorage({ prefix: 'custom:' })
            await customStorage.add(createTestTask())

            // Clear default storage
            await storage.clear()

            // Custom storage should still have tasks
            const customTasks = await customStorage.getAll()
            expect(customTasks).toHaveLength(1)

            // Default storage should be empty
            const defaultTasks = await storage.getAll()
            expect(defaultTasks).toHaveLength(0)
        })
    })
})

describe('ClientSessionStorage', () => {
    let storage: ClientSessionStorage
    let currentTime: number

    beforeEach(() => {
        currentTime = new Date('2024-01-01T00:00:00.000Z').getTime()
        vi.useFakeTimers()
        vi.setSystemTime(currentTime)
        mockSessionStorage.clear()
        storage = new ClientSessionStorage()
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    describe('constructor and init', () => {
        it('should initialize with default prefix', () => {
            const store = new ClientSessionStorage()
            expect(store['prefix']).toBe('cron:')
        })

        it('should initialize with custom prefix', () => {
            const store = new ClientSessionStorage({ prefix: 'session:' })
            expect(store['prefix']).toBe('session:')
        })

        it('should have async init method', async () => {
            await expect(storage.init()).resolves.toBeUndefined()
        })
    })

    describe('basic operations', () => {
        it('should add and retrieve tasks', async () => {
            const taskData = createTestTask()
            const task = await storage.add(taskData)

            const retrieved = await storage.get(task.id)

            // Compare serializable properties
            expect(retrieved).toMatchObject({
                id: task.id,
                name: task.name,
                status: task.status,
                options: task.options,
            })
        })

        it('should store in sessionStorage not localStorage', async () => {
            const task = await storage.add(createTestTask())

            expect(mockSessionStorage.getItem(`cron:${task.id}`)).toBeDefined()
            expect(mockLocalStorage.getItem(`cron:${task.id}`)).toBeNull()
        })

        it('should perform all CRUD operations', async () => {
            // Create
            const task = await storage.add(createTestTask())
            expect(task.id).toBeDefined()

            // Read
            const retrieved = await storage.get(task.id)
            expect(retrieved).toMatchObject({
                id: task.id,
                name: task.name,
            })

            // Update
            vi.advanceTimersByTime(1000)
            const updated = await storage.update(task.id, { name: 'Updated' })
            expect(updated.name).toBe('Updated')

            // Delete
            const removed = await storage.remove(task.id)
            expect(removed).toBe(true)

            const afterRemove = await storage.get(task.id)
            expect(afterRemove).toBeNull()
        })
    })
})

describe('createClientStorage', () => {
    beforeEach(() => {
        mockLocalStorage.clear()
        mockSessionStorage.clear()
    })

    it('should create memory storage', async () => {
        const storage = await createClientStorage({ type: 'memory' })
        expect(storage).toBeDefined()
        expect(storage.constructor.name).toBe('MemoryStorage')
    })

    it('should create localStorage with default config', async () => {
        const storage = await createClientStorage({ type: 'localStorage' })
        expect(storage).toBeDefined()

        const task = await storage.add(createTestTask())
        expect(mockLocalStorage.getItem(`cron:${task.id}`)).toBeDefined()
    })

    it('should create localStorage with custom config', async () => {
        const storage = await createClientStorage({
            type: 'localStorage',
            config: { prefix: 'test:' },
        })

        const task = await storage.add(createTestTask())
        const keys = Array.from(
            { length: mockLocalStorage.length },
            (_, i) => mockLocalStorage.key(i)!
        )
        expect(keys.some(k => k.startsWith('test:'))).toBe(true)
    })

    it('should create sessionStorage with default config', async () => {
        const storage = await createClientStorage({ type: 'sessionStorage' })
        expect(storage).toBeDefined()

        const task = await storage.add(createTestTask())
        expect(mockSessionStorage.getItem(`cron:${task.id}`)).toBeDefined()
    })

    it('should create sessionStorage with custom config', async () => {
        const storage = await createClientStorage({
            type: 'sessionStorage',
            config: { prefix: 'session:' },
        })

        const task = await storage.add(createTestTask())
        const keys = Array.from(
            { length: mockSessionStorage.length },
            (_, i) => mockSessionStorage.key(i)!
        )
        expect(keys.some(k => k.startsWith('session:'))).toBe(true)
    })

    it('should throw error for unsupported storage type', async () => {
        await expect(
            createClientStorage({ type: 'redis' as any })
        ).rejects.toThrow(
            'Storage type redis is not supported in browser environment'
        )
    })

    it('should call init on created storage', async () => {
        const storage = await createClientStorage({ type: 'localStorage' })
        // If init wasn't called, this would throw
        await expect(storage.add(createTestTask())).resolves.toBeDefined()
    })
})