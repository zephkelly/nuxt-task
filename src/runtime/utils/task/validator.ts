import type { CronTask, CronTaskOptions } from '../../types/task'
import CronExpressionUtils from '../expression/parser'



export interface ValidationResult {
    valid: boolean
    errors: string[]
}

export class TaskValidationError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'TaskValidationError'
    }
}

export class TaskValidator {
    private static readonly NAME_MAX_LENGTH = 100
    private static readonly MIN_TIMEOUT = 1000 // 1 second
    private static readonly MAX_TIMEOUT = 24 * 60 * 60 * 1000 // 24 hours
    private static readonly MIN_RETRY_DELAY = 100 // 100ms
    private static readonly MAX_RETRY_DELAY = 60 * 60 * 1000 // 1 hour
    private static readonly MAX_RETRIES = 10

    /**
     * Validates a Task's configuration
     * @throws {TaskValidationError} If validation fails
     */
    static validateTask(Task: CronTask): ValidationResult {
        const errors: string[] = []

        if (!Task.id) errors.push('Task ID is required')
        if (!Task.name) errors.push('Task name is required')
        if (!Task.execute || typeof Task.execute !== 'function') {
            errors.push('Task must have a valid execute function')
        }

        if (Task.name && Task.name.length > this.NAME_MAX_LENGTH) {
            errors.push(`Task name must not exceed ${this.NAME_MAX_LENGTH} characters`)
        }

        if (Task.name && !/^[\w\s-]+$/.test(Task.name)) {
            errors.push('Task name must only contain letters, numbers, spaces, and hyphens')
        }

        const validStatuses = ['pending', 'running', 'completed', 'failed', 'paused']
        if (Task.status && !validStatuses.includes(Task.status)) {
            errors.push(`Invalid Task status. Must be one of: ${validStatuses.join(', ')}`)
        }

        if (Task.options) {
            const optionsResult = this.validateTaskOptions(Task.options)
            errors.push(...optionsResult.errors)
        }

        if (Task.metadata) {
            if (typeof Task.metadata.runCount !== 'number') {
                errors.push('Metadata runCount must be a number')
            }
            if (Task.metadata.createdAt && !(Task.metadata.createdAt instanceof Date)) {
                errors.push('Metadata createdAt must be a Date object')
            }
            if (Task.metadata.updatedAt && !(Task.metadata.updatedAt instanceof Date)) {
                errors.push('Metadata updatedAt must be a Date object')
            }
            if (Task.metadata.nextRun && !(Task.metadata.nextRun instanceof Date)) {
                errors.push('Metadata nextRun must be a Date object')
            }
            if (Task.metadata.lastRun && !(Task.metadata.lastRun instanceof Date)) {
                errors.push('Metadata lastRun must be a Date object')
            }
            if (Task.metadata.lastError && !(Task.metadata.lastError instanceof Error)) {
                errors.push('Metadata lastError must be an Error object')
            }
        }

        return {
            valid: errors.length === 0,
            errors,
        }
    }

    static validateTaskOptions(options: CronTaskOptions): ValidationResult {
        const errors: string[] = []

        if (!options.expression) {
            errors.push('Cron expression is required')
        }
        else {
            try {
                CronExpressionUtils.parseCronExpression(options.expression)
            }
            catch (error) {
                errors.push(`Invalid cron expression: ${(error as Error).message}`)
            }
        }

        if (options.timezone) {
            try {
                Intl.DateTimeFormat(undefined, { timeZone: options.timezone })
            }
            catch (error) {
                errors.push(`Invalid timezone: ${options.timezone}`)
            }
        }

        if (options.maxRetries !== undefined) {
            if (!Number.isInteger(options.maxRetries) || options.maxRetries < 0) {
                errors.push('maxRetries must be a non-negative integer')
            }
            if (options.maxRetries > this.MAX_RETRIES) {
                errors.push(`maxRetries cannot exceed ${this.MAX_RETRIES}`)
            }
        }

        if (options.retryDelay !== undefined) {
            if (!Number.isInteger(options.retryDelay) || options.retryDelay < this.MIN_RETRY_DELAY) {
                errors.push(`retryDelay must be an integer >= ${this.MIN_RETRY_DELAY}ms`)
            }
            if (options.retryDelay > this.MAX_RETRY_DELAY) {
                errors.push(`retryDelay cannot exceed ${this.MAX_RETRY_DELAY}ms`)
            }
        }

        if (options.timeout !== undefined) {
            if (!Number.isInteger(options.timeout) || options.timeout < this.MIN_TIMEOUT) {
                errors.push(`timeout must be an integer >= ${this.MIN_TIMEOUT}ms`)
            }
            if (options.timeout > this.MAX_TIMEOUT) {
                errors.push(`timeout cannot exceed ${this.MAX_TIMEOUT}ms`)
            }
        }

        if (options.exclusive !== undefined && typeof options.exclusive !== 'boolean') {
            errors.push('exclusive must be a boolean')
        }
        if (options.catchUp !== undefined && typeof options.catchUp !== 'boolean') {
            errors.push('catchUp must be a boolean')
        }

        return {
            valid: errors.length === 0,
            errors,
        }
    }
}

export default TaskValidator