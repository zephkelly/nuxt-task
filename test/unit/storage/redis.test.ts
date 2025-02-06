// import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
// import { RedisStorage } from './../../../src/runtime/storage/environments/redis'
// import type { CronTask, CronTaskStatus } from './../../../src/runtime/task/types'

// // Define type for our mock Redis client to ensure type safety throughout tests
// type MockRedisClient = {
//     connect: ReturnType<typeof vi.fn>
//     set: ReturnType<typeof vi.fn>
//     get: ReturnType<typeof vi.fn>
//     keys: ReturnType<typeof vi.fn>
//     del: ReturnType<typeof vi.fn>
// }

// // Factory function to create consistent mock clients
// const createMockClient = (): MockRedisClient => ({
//     connect: vi.fn().mockResolvedValue(undefined),
//     set: vi.fn().mockResolvedValue('OK'),
//     get: vi.fn(),
//     keys: vi.fn().mockResolvedValue([]),
//     del: vi.fn().mockResolvedValue(1),
// })

// // Mock the redis module with support for both static and dynamic imports
// vi.mock('redis', async () => {
//     const mockClient = createMockClient()
//     // Import the actual module to preserve any other exports
//     const actual = await vi.importActual('redis') as any

//     return {
//         ...actual,
//         default: {
//             createClient: vi.fn().mockReturnValue(mockClient)
//         },
//         createClient: vi.fn().mockReturnValue(mockClient)
//     }
// })

// describe('RedisStorage', () => {
//     let storage: RedisStorage
//     let currentTime: number
//     let mockRedisClient: MockRedisClient

//     const redisConfig = {
//         url: 'redis://localhost:6379',
//         password: 'test-password',
//         database: 0,
//         prefix: 'test:'
//     }

//     beforeEach(async () => {
//         // Set up consistent time for all tests
//         currentTime = new Date('2024-01-01T00:00:00.000Z').getTime()
//         vi.useFakeTimers()
//         vi.setSystemTime(currentTime)

//         // Clear any previous mock state
//         vi.clearAllMocks()
//         vi.resetModules()

//         // Create fresh mock client for this test
//         mockRedisClient = createMockClient()

//         // Update the mock to use our new client
//         const redis = await import('redis')
//             ; (redis.createClient as any).mockReturnValue(mockRedisClient)

//         // Create fresh storage instance
//         storage = new RedisStorage(redisConfig)
//         await storage.init()
//     })

//     afterEach(() => {
//         vi.useRealTimers()
//     })

//     describe('constructor and initialization', () => {
//         it('should initialize with provided configuration', async () => {
//             const { createClient } = await import('redis')
//             expect(createClient).toHaveBeenCalledWith({
//                 url: redisConfig.url,
//                 password: redisConfig.password,
//                 database: redisConfig.database,
//             })
//             expect(mockRedisClient.connect).toHaveBeenCalled()
//         })

//         it('should throw error when redis module is unavailable', async () => {
//             // Create mock that simulates module failure
//             const errorMock = createMockClient()
//             errorMock.connect.mockRejectedValueOnce(new Error('Connection failed'))

//             const redis = await import('redis')
//                 ; (redis.createClient as any).mockReturnValue(errorMock)

//             const storageInstance = new RedisStorage(redisConfig)
//             await expect(storageInstance.init()).rejects.toThrow('Redis client unavailable')
//         })

//         it('should initialize with minimal configuration', async () => {
//             const minimalConfig = {
//                 url: 'redis://localhost:6379'
//             }
//             const minimalStorage = new RedisStorage(minimalConfig)
//             await minimalStorage.init()

//             const { createClient } = await import('redis')
//             expect(createClient).toHaveBeenCalledWith({
//                 url: minimalConfig.url,
//                 password: undefined,
//                 database: undefined,
//             })
//         })
//     })

//     describe('add', () => {
//         it('should add a new task with generated id', async () => {
//             const taskData = {
//                 name: 'Test Task',
//                 status: 'pending' as CronTaskStatus,
//                 options: {
//                     expression: '* * * * *',
//                     timeout: 1000
//                 },
//                 execute: async () => 'test',
//                 metadata: {
//                     runCount: 0,
//                     lastRun: undefined,
//                     nextRun: undefined,
//                     lastError: undefined,
//                     createdAt: new Date(),
//                     updatedAt: new Date()
//                 }
//             }

//             mockRedisClient.set.mockResolvedValueOnce('OK')

//             const task = await storage.add(taskData)

//             // Verify task properties
//             expect(task).toMatchObject({
//                 ...taskData,
//                 id: expect.any(String),
//                 metadata: {
//                     ...taskData.metadata,
//                     createdAt: new Date(currentTime),
//                     updatedAt: new Date(currentTime)
//                 }
//             })

//             // Verify Redis interaction
//             expect(mockRedisClient.set).toHaveBeenCalledWith(
//                 `${redisConfig.prefix}${task.id}`,
//                 expect.any(String)
//             )

//             // Verify stored data structures
//             const storedData = await storage.parseTask(mockRedisClient.set.mock.calls[0][1])
//             expect(storedData).toEqual(task)
//         })
//     })

//     describe('get', () => {
//         it('should retrieve a task by id', async () => {
//             const mockTask = {
//                 id: 'test-id',
//                 name: 'Test Task',
//                 status: 'pending' as CronTaskStatus,
//                 options: { expression: '* * * * *' },
//                 execute: async () => 'test',
//                 metadata: {
//                     runCount: 0,
//                     lastRun: undefined,
//                     nextRun: undefined,
//                     lastError: undefined,
//                     createdAt: new Date(currentTime),
//                     updatedAt: new Date(currentTime)
//                 }
//             }

//             mockRedisClient.get.mockResolvedValueOnce(JSON.stringify(mockTask))

//             const task = await storage.get('test-id')
//             expect(task).toEqual(mockTask)
//             expect(mockRedisClient.get).toHaveBeenCalledWith(`${redisConfig.prefix}test-id`)
//         })

//         it('should return null for non-existent task', async () => {
//             mockRedisClient.get.mockResolvedValueOnce(null)
//             const task = await storage.get('non-existent')
//             expect(task).toBeNull()
//         })
//     })

//     describe('getAll', () => {
//         it('should retrieve all tasks', async () => {
//             const mockTasks = [
//                 {
//                     id: 'task-1',
//                     name: 'Task 1',
//                     status: 'pending' as CronTaskStatus,
//                     options: { expression: '* * * * *' },
//                     execute: async () => 'test1',
//                     metadata: {
//                         runCount: 0,
//                         lastRun: undefined,
//                         nextRun: undefined,
//                         lastError: undefined,
//                         createdAt: new Date(currentTime),
//                         updatedAt: new Date(currentTime)
//                     }
//                 },
//                 {
//                     id: 'task-2',
//                     name: 'Task 2',
//                     status: 'active' as CronTaskStatus,
//                     options: { expression: '0 * * * *' },
//                     execute: async () => 'test2',
//                     metadata: {
//                         runCount: 1,
//                         lastRun: new Date(currentTime - 3600000),
//                         nextRun: new Date(currentTime + 3600000),
//                         lastError: undefined,
//                         createdAt: new Date(currentTime - 7200000),
//                         updatedAt: new Date(currentTime - 3600000)
//                     }
//                 }
//             ]

//             mockRedisClient.keys.mockResolvedValueOnce([
//                 `${redisConfig.prefix}task-1`,
//                 `${redisConfig.prefix}task-2`
//             ])
//             mockRedisClient.get
//                 .mockResolvedValueOnce(JSON.stringify(mockTasks[0]))
//                 .mockResolvedValueOnce(JSON.stringify(mockTasks[1]))

//             const tasks = await storage.getAll()
//             expect(tasks).toEqual(mockTasks)
//         })

//         it('should return empty array when no tasks exist', async () => {
//             mockRedisClient.keys.mockResolvedValueOnce([])
//             const tasks = await storage.getAll()
//             expect(tasks).toEqual([])
//         })
//     })

//     describe('error handling', () => {
//         it('should handle redis connection errors', async () => {
//             mockRedisClient.set.mockRejectedValueOnce(new Error('Connection failed'))

//             const taskData = {
//                 name: 'Test Task',
//                 status: 'pending' as CronTaskStatus,
//                 options: { expression: '* * * * *' },
//                 execute: async () => 'test',
//                 metadata: {
//                     runCount: 0,
//                     lastRun: undefined,
//                     nextRun: undefined,
//                     lastError: undefined,
//                     createdAt: new Date(),
//                     updatedAt: new Date()
//                 }
//             }

//             await expect(storage.add(taskData)).rejects.toThrow('Connection failed')
//         })

//         it('should handle invalid JSON in stored tasks', async () => {
//             mockRedisClient.get.mockResolvedValueOnce('invalid json')
//             const task = await storage.get('test-id')
//             expect(task).toBeNull()
//         })

//         it('should handle Redis client errors during operations', async () => {
//             mockRedisClient.set.mockRejectedValueOnce(new Error('Redis connection lost'))

//             const taskData = {
//                 name: 'Test Task',
//                 status: 'pending' as CronTaskStatus,
//                 options: { expression: '* * * * *' },
//                 execute: async () => 'test',
//                 metadata: {
//                     runCount: 0,
//                     lastRun: undefined,
//                     nextRun: undefined,
//                     lastError: undefined,
//                     createdAt: new Date(),
//                     updatedAt: new Date()
//                 }
//             }

//             await expect(storage.add(taskData)).rejects.toThrow('Redis connection lost')
//         })

//         it('should handle Redis connection timeout', async () => {
//             const errorMock = createMockClient()
//             errorMock.connect.mockRejectedValueOnce(new Error('Connection timeout'))

//             const redis = await import('redis')
//                 ; (redis.createClient as any).mockReturnValue(errorMock)

//             const storageInstance = new RedisStorage(redisConfig)
//             await expect(storageInstance.init()).rejects.toThrow('Redis client unavailable')
//         })
//     })
// })