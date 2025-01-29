import { randomUUID } from 'crypto';
import { isValidDate } from '../../date';

import type { BaseStorageConfig } from '../types';
import type { CronJob } from '../../job/types';



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

    protected validateDates(job: Partial<CronJob>): { lastRun?: Date; nextRun?: Date } {
        return {
            lastRun: job.lastRun && isValidDate(job.lastRun) ? job.lastRun : undefined,
            nextRun: job.nextRun && isValidDate(job.nextRun) ? job.nextRun : undefined,
        };
    }

    protected createJobObject(
        job: Omit<CronJob, 'id' | 'createdAt' | 'updatedAt'>,
        id?: string
    ): CronJob {
        const now = new Date();
        const { lastRun, nextRun } = this.validateDates(job);
        
        return {
            ...job,
            id: id || this.generateId(),
            lastRun,
            nextRun,
            createdAt: now,
            updatedAt: now,
        };
    }

    protected updateJobObject(
        existingJob: CronJob,
        updates: Partial<CronJob>
    ): CronJob {
        const { lastRun, nextRun } = this.validateDates(updates);
        
        return {
            ...existingJob,
            ...updates,
            lastRun: 'lastRun' in updates ? lastRun : existingJob.lastRun,
            nextRun: 'nextRun' in updates ? nextRun : existingJob.nextRun,
            id: existingJob.id,
            updatedAt: new Date(),
        };
    }
}