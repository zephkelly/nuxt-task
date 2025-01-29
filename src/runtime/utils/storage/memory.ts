import { randomUUID } from 'crypto';
import { isValidDate } from './../date';

import type { CronJob } from './../job/types';
import type { CronStorage } from './types';



export class MemoryStorage implements CronStorage {
    private jobs: Map<string, CronJob> = new Map();

    async init(): Promise<void> {
        // Nothing needed for memory storage
    }

    async add(job: Omit<CronJob, 'id' | 'createdAt' | 'updatedAt'>): Promise<CronJob> {
        const id = randomUUID();
        const now = new Date();
        
        // Validate dates and convert invalid ones to undefined
        const lastRun = job.lastRun && isValidDate(job.lastRun) ? job.lastRun : undefined;
        const nextRun = job.nextRun && isValidDate(job.nextRun) ? job.nextRun : undefined;
        
        const newJob: CronJob = {
            ...job,
            id,
            lastRun,
            nextRun,
            createdAt: now,
            updatedAt: now
        };
        
        this.jobs.set(id, newJob);
        return newJob;
    }

    async get(id: string): Promise<CronJob | null> {
        return this.jobs.get(id) || null;
    }

    async getAll(): Promise<CronJob[]> {
        return Array.from(this.jobs.values());
    }

    async update(id: string, updates: Partial<CronJob>): Promise<CronJob> {
        const job = await this.get(id);
        if (!job) {
            throw new Error(`Job with id ${id} not found`);
        }

        // Create a new object without date fields first
        const { lastRun, nextRun, ...otherUpdates } = updates;
        
        // Handle date updates separately with validation
        let updatedLastRun = job.lastRun;
        let updatedNextRun = job.nextRun;

        // Only update dates if they're included in the updates
        if ('lastRun' in updates) {
            updatedLastRun = isValidDate(updates.lastRun) ? updates.lastRun : undefined;
        }
        if ('nextRun' in updates) {
            updatedNextRun = isValidDate(updates.nextRun) ? updates.nextRun : undefined;
        }

        const updatedJob: CronJob = {
            ...job,
            ...otherUpdates,
            lastRun: updatedLastRun,
            nextRun: updatedNextRun,
            id, // Prevent id from being updated
            updatedAt: new Date()
        };

        this.jobs.set(id, updatedJob);
        return updatedJob;
    }

    async remove(id: string): Promise<boolean> {
        return this.jobs.delete(id);
    }

    async clear(): Promise<void> {
        this.jobs.clear();
    }
}