import type { RedisClientType, RedisModules, RedisFunctions, RedisScripts } from 'redis'

import type { CronTask } from '../../task/types'
import type { CronStorage } from '../types'

import { BaseStorage, type BaseStorageConfig } from './base'



export interface RedisConfig extends BaseStorageConfig {
    url: string
    password?: string
    database?: number
}

type RedisClient = RedisClientType<RedisModules, RedisFunctions, RedisScripts>

export class RedisStorage extends BaseStorage implements CronStorage {
    private client!: RedisClient

    constructor(private config: RedisConfig) {
        super(config)
    }

    async init(): Promise<void> {
        try {
            const { createClient } = await import('redis')

            this.client = createClient({
                url: this.config.url,
                password: this.config.password,
                database: this.config.database,
            })

            await this.client.connect()
        }
        catch (error) {
            throw new Error('Redis client unavailable')
        }
    }

    async add(Task: Omit<CronTask, 'id' | 'createdAt' | 'updatedAt'>): Promise<CronTask> {
        const newTask = this.createTaskObject(Task)

        await this.client.set(
            this.getKey(newTask.id),
            JSON.stringify(newTask),
        )

        return newTask
    }

    async get(id: string): Promise<CronTask | null> {
        const data = await this.client.get(this.getKey(id))

        if (!data) return null

        return await this.parseTask(data)
    }

    async getAll(): Promise<CronTask[]> {
        const keys = await this.client.keys(`${this.prefix}*`)

        if (!keys.length) return []

        const storedTasks = await Promise.all(
            keys.map(key => this.client.get(key)),
        )

        const filteredTasks = await Promise.all(
            storedTasks
                .filter((stringifyedTask): stringifyedTask is string => stringifyedTask !== null)
                .map(async stringifyedTask => {
                    const typedTask = await this.parseTask(stringifyedTask)
                    return typedTask
                })
        );

        return filteredTasks
    }

    async update(id: string, updates: Partial<CronTask>): Promise<CronTask> {
        const Task = await this.get(id)

        if (!Task) {
            throw new Error(`Task with id ${id} not found`)
        }

        const updatedTask = this.updateTaskObject(Task, updates)
        await this.client.set(this.getKey(id), JSON.stringify(updatedTask))

        return updatedTask
    }

    async remove(id: string): Promise<boolean> {
        const result = await this.client.del(this.getKey(id))
        return result > 0
    }

    async clear(): Promise<void> {
        const keys = await this.client.keys(`${this.prefix}*`)

        if (keys.length) {
            await this.client.del(keys)
        }
    }

    async parseTask(stringifyedTask: string): Promise<CronTask> {
        const parsedTask = JSON.parse(stringifyedTask);

        const cleanMetadata = Object.fromEntries(
            Object.entries(parsedTask.metadata)
                .filter(([_, value]) => value !== undefined)
        );

        const typedTask: CronTask = {
            ...parsedTask,
            metadata: {
                ...cleanMetadata,
                lastRun: parsedTask.metadata.lastRun ? new Date(parsedTask.metadata.lastRun) : undefined,
                nextRun: parsedTask.metadata.nextRun ? new Date(parsedTask.metadata.nextRun) : undefined,
                createdAt: new Date(parsedTask.metadata.createdAt),
                updatedAt: new Date(parsedTask.metadata.updatedAt)
            }
        }

        return typedTask
    }
}

/*
* Create a new Redis storage instance
* @param {RedisConfig} config - The Redis configuration object
* @returns {Promise<CronStorage>} - A new Redis storage instance
* @throws {Error} - If the Redis client is unavailable
* @example
* const storage = await createRedisStorage({
*    url: 'redis://localhost:6379',
*   password: 'password',
*  database: 0,
* })
*/
export async function createRedisStorage(config: RedisConfig): Promise<CronStorage> {
    const storage = new RedisStorage(config)
    await storage.init()
    return storage
}