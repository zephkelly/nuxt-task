import { randomUUID } from 'crypto';
import type { CronJob, JobMetadata } from '../../job/types';
import type { CronStorage } from '../types';



export class MemoryStorage implements CronStorage {
    private jobs: Map<string, CronJob> = new Map();

    async init(): Promise<void> {
        // Nothing needed for memory storage
    }

    async add(job: Omit<CronJob, 'id' | 'metadata'>): Promise<CronJob> {
        const id = this.generateId();
        const now = new Date();
        
        const newJob: CronJob = {
            ...job,
            id,
            metadata: this.createJobMetadata(job, now)
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

        const updatedJob = this.updateJobObject(job, updates);
        this.jobs.set(id, updatedJob);
        return updatedJob;
    }

    async remove(id: string): Promise<boolean> {
        return this.jobs.delete(id);
    }

    async clear(): Promise<void> {
        this.jobs.clear();
    }

    protected generateId(): string {
        return randomUUID();
    }

    protected createJobMetadata(job: Partial<CronJob>, now: Date): JobMetadata {
        return {
            lastRun: this.validateDate(job.metadata?.lastRun),
            nextRun: this.validateDate(job.metadata?.nextRun),
            lastError: job.metadata?.lastError,
            runCount: job.metadata?.runCount ?? 0,
            createdAt: now,
            updatedAt: now
        };
    }

    protected validateDate(date: unknown): Date | undefined {
        if (date instanceof Date && !isNaN(date.getTime())) {
            return date;
        }
        return undefined;
    }

    protected updateJobObject(
        existingJob: CronJob,
        updates: Partial<CronJob>
    ): CronJob {
        const now = new Date();
        const metadata: JobMetadata = {
            ...existingJob.metadata,
            ...updates.metadata,
            updatedAt: now,
            lastRun: updates.metadata?.lastRun !== undefined 
                ? this.validateDate(updates.metadata.lastRun)
                : existingJob.metadata.lastRun,
            nextRun: updates.metadata?.nextRun !== undefined
                ? this.validateDate(updates.metadata.nextRun)
                : existingJob.metadata.nextRun
        };

        return {
            ...existingJob,
            ...updates,
            id: existingJob.id,
            metadata
        };
    }
}


export function createMemoryStorage(): CronStorage {
    return new MemoryStorage();
}