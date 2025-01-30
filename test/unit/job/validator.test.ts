import { describe, it, expect } from 'vitest'
import { JobValidator } from '../../../src/runtime/utils/job/validator'
import type { CronJob } from '../../../src/runtime/utils/job/types'

describe('JobValidator', () => {
    const validJob: CronJob = {
        id: 'test-job',
        name: 'Test Job',
        status: 'pending',
        execute: async () => 'result',
        options: {
            expression: '* * * * *',
            maxRetries: 3,
            retryDelay: 1000,
            timeout: 5000,
            exclusive: true,
            catchUp: false,
        },
        metadata: {
            runCount: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
        },
    }

    describe('validateJob', () => {
        it('should validate a valid job', () => {
            const result = JobValidator.validateJob(validJob)
            expect(result.valid).toBe(true)
            expect(result.errors).toHaveLength(0)
        })

        it('should validate required fields', () => {
            const invalidJob = { ...validJob, id: '', name: '' }
            const result = JobValidator.validateJob(invalidJob)
            expect(result.valid).toBe(false)
            expect(result.errors).toContain('Job ID is required')
            expect(result.errors).toContain('Job name is required')
        })

        it('should validate name constraints', () => {
            const longName = 'a'.repeat(101)
            const specialChars = 'Test@Job#123'

            const result1 = JobValidator.validateJob({ ...validJob, name: longName })
            expect(result1.valid).toBe(false)
            expect(result1.errors).toContain('Job name must not exceed 100 characters')

            const result2 = JobValidator.validateJob({ ...validJob, name: specialChars })
            expect(result2.valid).toBe(false)
            expect(result2.errors).toContain('Job name must only contain letters, numbers, spaces, and hyphens')
        })

        it('should validate execute function', () => {
            const invalidJob = { ...validJob, execute: 'not a function' as any }
            const result = JobValidator.validateJob(invalidJob)
            expect(result.valid).toBe(false)
            expect(result.errors).toContain('Job must have a valid execute function')
        })

        it('should validate job status', () => {
            const invalidJob = { ...validJob, status: 'invalid' as any }
            const result = JobValidator.validateJob(invalidJob)
            expect(result.valid).toBe(false)
            expect(result.errors).toContain('Invalid job status. Must be one of: pending, running, completed, failed, paused')
        })

        it('should validate metadata types', () => {
            const invalidMetadata = {
                ...validJob,
                metadata: {
                runCount: '0' as any,
                createdAt: 'invalid' as any,
                updatedAt: 'invalid' as any,
                nextRun: 'invalid' as any,
                lastRun: 'invalid' as any,
                lastError: 'invalid' as any,
                },
            }

            const result = JobValidator.validateJob(invalidMetadata)
            expect(result.valid).toBe(false)
            expect(result.errors).toContain('Metadata runCount must be a number')
            expect(result.errors).toContain('Metadata createdAt must be a Date object')
            expect(result.errors).toContain('Metadata updatedAt must be a Date object')
            expect(result.errors).toContain('Metadata nextRun must be a Date object')
            expect(result.errors).toContain('Metadata lastRun must be a Date object')
            expect(result.errors).toContain('Metadata lastError must be an Error object')
        })
    })

    describe('validateJobOptions', () => {
        it('should validate cron expression', () => {
            const invalidOptions = { ...validJob.options, expression: 'invalid' }
            const result = JobValidator.validateJobOptions(invalidOptions)
            expect(result.valid).toBe(false)
            expect(result.errors[0]).toContain('Invalid cron expression')
        })

        it('should validate timezone', () => {
            const validTimezone = { ...validJob.options, timezone: 'America/New_York' }
            const invalidTimezone = { ...validJob.options, timezone: 'Invalid/Timezone' }

            const result1 = JobValidator.validateJobOptions(validTimezone)
            expect(result1.valid).toBe(true)

            const result2 = JobValidator.validateJobOptions(invalidTimezone)
            expect(result2.valid).toBe(false)
            expect(result2.errors).toContain('Invalid timezone: Invalid/Timezone')
        })

        it('should validate retry options', () => {
            const invalidRetry = {
                ...validJob.options,
                maxRetries: -1,
                retryDelay: 50,
            }

            const result = JobValidator.validateJobOptions(invalidRetry)
            expect(result.valid).toBe(false)
            expect(result.errors).toContain('maxRetries must be a non-negative integer')
            expect(result.errors).toContain('retryDelay must be an integer >= 100ms')
        })

        it('should validate timeout', () => {
            const invalidTimeout = {
                ...validJob.options,
                timeout: 500, // Less than minimum
            }

            const result = JobValidator.validateJobOptions(invalidTimeout)
            expect(result.valid).toBe(false)
            expect(result.errors).toContain('timeout must be an integer >= 1000ms')
        })

        it('should validate boolean flags', () => {
            const invalidFlags = {
                ...validJob.options,
                exclusive: 'true' as any,
                catchUp: 1 as any,
            }

            const result = JobValidator.validateJobOptions(invalidFlags)
            expect(result.valid).toBe(false)
            expect(result.errors).toContain('exclusive must be a boolean')
            expect(result.errors).toContain('catchUp must be a boolean')
        })

        it('should validate maximum constraints', () => {
            const exceedLimits = {
                ...validJob.options,
                maxRetries: 11,
                retryDelay: 24 * 60 * 60 * 1000 + 1,
                timeout: 25 * 60 * 60 * 1000,
            }

            const result = JobValidator.validateJobOptions(exceedLimits)
            expect(result.valid).toBe(false)
            expect(result.errors).toContain('maxRetries cannot exceed 10')
            expect(result.errors).toContain('retryDelay cannot exceed 3600000ms')
            expect(result.errors).toContain('timeout cannot exceed 86400000ms')
        })
    })
})