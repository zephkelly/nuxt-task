import type { CronJob, CronJobOptions } from './types';
import { parseCronExpression } from '../expression';



export interface ValidationResult {
    valid: boolean;
    errors: string[];
}

export class JobValidationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'JobValidationError';
    }
}

export class JobValidator {
    private static readonly NAME_MAX_LENGTH = 100;
    private static readonly MIN_TIMEOUT = 1000; // 1 second
    private static readonly MAX_TIMEOUT = 24 * 60 * 60 * 1000; // 24 hours
    private static readonly MIN_RETRY_DELAY = 100; // 100ms
    private static readonly MAX_RETRY_DELAY = 60 * 60 * 1000; // 1 hour
    private static readonly MAX_RETRIES = 10;

    /**
     * Validates a job's configuration
     * @throws {JobValidationError} If validation fails
     */
    static validateJob(job: CronJob): ValidationResult {
        const errors: string[] = [];

        if (!job.id) errors.push('Job ID is required');
        if (!job.name) errors.push('Job name is required');
        if (!job.execute || typeof job.execute !== 'function') {
            errors.push('Job must have a valid execute function');
        }

        if (job.name && job.name.length > this.NAME_MAX_LENGTH) {
            errors.push(`Job name must not exceed ${this.NAME_MAX_LENGTH} characters`);
        }
        if (job.name && !/^[\w\s-]+$/.test(job.name)) {
            errors.push('Job name must only contain letters, numbers, spaces, and hyphens');
        }

        const validStatuses = ['pending', 'running', 'completed', 'failed', 'paused'];
        if (job.status && !validStatuses.includes(job.status)) {
            errors.push(`Invalid job status. Must be one of: ${validStatuses.join(', ')}`);
        }

        if (job.options) {
            const optionsResult = this.validateJobOptions(job.options);
            errors.push(...optionsResult.errors);
        }

        if (job.metadata) {
            if (typeof job.metadata.runCount !== 'number') {
                errors.push('Metadata runCount must be a number');
            }
            if (job.metadata.createdAt && !(job.metadata.createdAt instanceof Date)) {
                errors.push('Metadata createdAt must be a Date object');
            }
            if (job.metadata.updatedAt && !(job.metadata.updatedAt instanceof Date)) {
                errors.push('Metadata updatedAt must be a Date object');
            }
            if (job.metadata.nextRun && !(job.metadata.nextRun instanceof Date)) {
                errors.push('Metadata nextRun must be a Date object');
            }
            if (job.metadata.lastRun && !(job.metadata.lastRun instanceof Date)) {
                errors.push('Metadata lastRun must be a Date object');
            }
            if (job.metadata.lastError && !(job.metadata.lastError instanceof Error)) {
                errors.push('Metadata lastError must be an Error object');
            }
        }

        return {
            valid: errors.length === 0,
            errors
        };
    }

    static validateJobOptions(options: CronJobOptions): ValidationResult {
        const errors: string[] = [];

        if (!options.expression) {
            errors.push('Cron expression is required');
        } else {
            try {
                parseCronExpression(options.expression);
            } catch (error) {
                errors.push(`Invalid cron expression: ${(error as Error).message}`);
            }
        }

        if (options.timezone) {
            try {
                Intl.DateTimeFormat(undefined, { timeZone: options.timezone });
            } catch (error) {
                errors.push(`Invalid timezone: ${options.timezone}`);
            }
        }

        if (options.maxRetries !== undefined) {
            if (!Number.isInteger(options.maxRetries) || options.maxRetries < 0) {
                errors.push('maxRetries must be a non-negative integer');
            }
            if (options.maxRetries > this.MAX_RETRIES) {
                errors.push(`maxRetries cannot exceed ${this.MAX_RETRIES}`);
            }
        }

        if (options.retryDelay !== undefined) {
            if (!Number.isInteger(options.retryDelay) || options.retryDelay < this.MIN_RETRY_DELAY) {
                errors.push(`retryDelay must be an integer >= ${this.MIN_RETRY_DELAY}ms`);
            }
            if (options.retryDelay > this.MAX_RETRY_DELAY) {
                errors.push(`retryDelay cannot exceed ${this.MAX_RETRY_DELAY}ms`);
            }
        }

        if (options.timeout !== undefined) {
            if (!Number.isInteger(options.timeout) || options.timeout < this.MIN_TIMEOUT) {
                errors.push(`timeout must be an integer >= ${this.MIN_TIMEOUT}ms`);
            }
            if (options.timeout > this.MAX_TIMEOUT) {
                errors.push(`timeout cannot exceed ${this.MAX_TIMEOUT}ms`);
            }
        }

        if (options.exclusive !== undefined && typeof options.exclusive !== 'boolean') {
            errors.push('exclusive must be a boolean');
        }
        if (options.catchUp !== undefined && typeof options.catchUp !== 'boolean') {
            errors.push('catchUp must be a boolean');
        }

        return {
            valid: errors.length === 0,
            errors
        };
    }
}