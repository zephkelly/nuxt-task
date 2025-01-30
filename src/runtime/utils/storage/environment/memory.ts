import type { CronJob } from '../../job/types'
import type { CronStorage } from '../types'

import { BaseStorage } from './base'



export class MemoryStorage extends BaseStorage implements CronStorage {
    private jobs: Map<string, CronJob> = new Map()
  
    async init(): Promise<void> { }
  
    async add(job: CronJob | Omit<CronJob, 'id' | 'metadata'>): Promise<CronJob> {
        if ('id' in job && 'metadata' in job) {
            const existingJob = job as CronJob;
            
            if (this.jobs.has(existingJob.id)) {
                throw new Error(`Job with id ${existingJob.id} already exists`);
            }
            
            this.jobs.set(existingJob.id, existingJob);
            return existingJob;
        }
        
        const newJob = this.createJobObject(job);
        
        if (this.jobs.has(newJob.id)) {
            throw new Error(`Job with id ${newJob.id} already exists`);
        }
        
        this.jobs.set(newJob.id, newJob);
        return newJob;
    }
  
    async get(id: string): Promise<CronJob | null> {
        return this.jobs.get(id) || null
    }
  
    async getAll(): Promise<CronJob[]> {
        return Array.from(this.jobs.values())
    }
  
    async update(id: string, updates: Partial<CronJob>): Promise<CronJob> {
        const job = await this.get(id)
        if (!job) {
            throw new Error(`Job with id ${id} not found`)
        }
        const updatedJob = this.updateJobObject(job, updates)
        this.jobs.set(id, updatedJob)
        return updatedJob
    }
  
    async remove(id: string): Promise<boolean> {
        return this.jobs.delete(id)
    }
  
    async clear(): Promise<void> {
        this.jobs.clear()
    }
}


export function createMemoryStorage(): CronStorage {
    return new MemoryStorage()
}