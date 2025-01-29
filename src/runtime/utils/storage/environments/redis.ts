import { createClient } from 'redis';
import type { CronJob } from './../../job/types';
import type { CronStorage, RedisConfig } from '../types';
import { BaseStorage } from './base';



export class RedisStorage extends BaseStorage implements CronStorage {
    private client: ReturnType<typeof createClient>;
    
    constructor(private config: RedisConfig) {
        super(config);
        this.client = createClient({
            url: config.url,
            password: config.password,
            database: config.database
        });
    }

    async init(): Promise<void> {
        await this.client.connect();
    }

    async add(job: Omit<CronJob, 'id' | 'createdAt' | 'updatedAt'>): Promise<CronJob> {
        const newJob = this.createJobObject(job);
        await this.client.set(
            this.getKey(newJob.id),
            JSON.stringify(newJob)
        );
        return newJob;
    }

    async get(id: string): Promise<CronJob | null> {
        const data = await this.client.get(this.getKey(id));
        if (!data) return null;
        
        return JSON.parse(data);
    }

    async getAll(): Promise<CronJob[]> {
        const keys = await this.client.keys(`${this.prefix}*`);
        if (!keys.length) return [];

        const jobs = await Promise.all(
            keys.map(key => this.client.get(key))
        );

        return jobs
            .filter((job): job is string => job !== null)
            .map(job => JSON.parse(job));
    }

    async update(id: string, updates: Partial<CronJob>): Promise<CronJob> {
        const job = await this.get(id);
        if (!job) {
            throw new Error(`Job with id ${id} not found`);
        }

        const updatedJob = this.updateJobObject(job, updates);
        await this.client.set(this.getKey(id), JSON.stringify(updatedJob));
        
        return updatedJob;
    }

    async remove(id: string): Promise<boolean> {
        const result = await this.client.del(this.getKey(id));
        return result > 0;
    }

    async clear(): Promise<void> {
        const keys = await this.client.keys(`${this.prefix}*`);
        if (keys.length) {
            await this.client.del(keys);
        }
    }
}