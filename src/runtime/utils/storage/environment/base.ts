import { randomUUID } from 'crypto';

import type { BaseStorageConfig } from '../types';
import type { CronJob, JobMetadata } from '../../job/types';



export abstract class BaseStorage {
    protected prefix: string;

    constructor(config?: BaseStorageConfig) {
        this.prefix = config?.prefix || 'cron:';
    }

    protected generateId(): string {
        return randomUUID();
    }

    protected getKey(id: string): string {
        return `${this.prefix}${id}`;
    }

    protected validateDate(date: unknown): Date | undefined {
        if (date instanceof Date && !isNaN(date.getTime())) {
            return date;
        }
        return undefined;
    }

    protected createJobMetadata(
        job: Partial<CronJob>,
        now: Date
    ): JobMetadata {
        return {
            lastRun: this.validateDate(job.metadata?.lastRun),
            nextRun: this.validateDate(job.metadata?.nextRun),
            lastError: job.metadata?.lastError,
            runCount: job.metadata?.runCount ?? 0,
            createdAt: now,
            updatedAt: now
        };
    }

    protected createJobObject(
        job: Omit<CronJob, 'id' | 'metadata'>,
        id?: string
    ): CronJob {
        const now = new Date();
        
        return {
            ...job,
            id: id || this.generateId(),
            metadata: this.createJobMetadata(job, now)
        };
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