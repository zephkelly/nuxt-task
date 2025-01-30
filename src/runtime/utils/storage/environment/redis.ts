import type { RedisClientType, RedisModules, RedisFunctions, RedisScripts } from 'redis'
import type { CronJob } from '../../job/types'
import type { CronStorage, RedisConfig } from '../types'
import { BaseStorage } from './base'

type RedisClient = RedisClientType<RedisModules, RedisFunctions, RedisScripts>



class RedisStorage extends BaseStorage implements CronStorage {
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
            throw new Error('Redis client unavailable. Make sure redis is installed: npm install redis')
        }
    }

    async add(job: Omit<CronJob, 'id' | 'createdAt' | 'updatedAt'>): Promise<CronJob> {
        const newJob = this.createJobObject(job)

        await this.client.set(
            this.getKey(newJob.id),
            JSON.stringify(newJob),
        )

        return newJob
    }

    async get(id: string): Promise<CronJob | null> {
        const data = await this.client.get(this.getKey(id))

        if (!data) return null

        return JSON.parse(data)
    }

    async getAll(): Promise<CronJob[]> {
        const keys = await this.client.keys(`${this.prefix}*`)

        if (!keys.length) return []

        const jobs = await Promise.all(
            keys.map(key => this.client.get(key)),
        )

        return jobs
            .filter((job): job is string => job !== null)
            .map(job => JSON.parse(job))
    }

    async update(id: string, updates: Partial<CronJob>): Promise<CronJob> {
        const job = await this.get(id)

        if (!job) {
            throw new Error(`Job with id ${id} not found`)
        }

        const updatedJob = this.updateJobObject(job, updates)
        await this.client.set(this.getKey(id), JSON.stringify(updatedJob))

        return updatedJob
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
}

export async function createRedisStorage(config: RedisConfig): Promise<CronStorage> {
    const storage = new RedisStorage(config)
    await storage.init()
    return storage
}