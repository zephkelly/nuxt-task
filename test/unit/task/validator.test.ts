import { describe, it, expect } from 'vitest'
import TaskValidator from '../../../src/runtime/task/validator'
import type { CronTask } from '../../../src/runtime/task/types'

describe('TaskValidator', () => {
        const validTask: CronTask = {
                id: 'test-Task',
                name: 'Test Task',
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
        };

        describe('validateTask', () => {
                it('should validate a valid Task', () => {
                        const result = TaskValidator.validateTask(validTask)
      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should validate required fields', () => {
                        const invalidTask = { ...validTask, id: '', name: '' }
      const result = TaskValidator.validateTask(invalidTask)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Task ID is required')
      expect(result.errors).toContain('Task name is required')
    })

    it('should validate name constraints', () => {
                        const longName = 'a'.repeat(101)
      const specialChars = 'Test@Task#123'

      const result1 = TaskValidator.validateTask({
                                ...validTask,
                                name: longName,
                        })
      expect(result1.valid).toBe(false)
      expect(result1.errors).toContain(
                                "Task name must not exceed 100 characters"
                        );

                        const result2 = TaskValidator.validateTask({
                                ...validTask,
                                name: specialChars,
                        })
      expect(result2.valid).toBe(false)
      expect(result2.errors).toContain(
                                "Task name must only contain letters, numbers, spaces, and hyphens"
                        );
                })

    it('should validate execute function', () => {
                        const invalidTask = {
                                ...validTask,
                                execute: 'not a function' as any,
                        };
                        const result = TaskValidator.validateTask(invalidTask)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain(
                                "Task must have a valid execute function"
                        );
                })

    it('should validate Task status', () => {
                        const invalidTask = { ...validTask, status: 'invalid' as any }
      const result = TaskValidator.validateTask(invalidTask)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain(
                                "Invalid Task status. Must be one of: pending, running, completed, failed, paused"
                        );
                })

    it('should validate metadata types', () => {
                        const invalidMetadata = {
                                ...validTask,
                                metadata: {
                                        runCount: '0' as any,
                                        createdAt: 'invalid' as any,
                                        updatedAt: 'invalid' as any,
                                        nextRun: 'invalid' as any,
                                        lastRun: 'invalid' as any,
                                        lastError: 'invalid' as any,
                                },
                        };

                        const result = TaskValidator.validateTask(invalidMetadata)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain(
                                "Metadata runCount must be a number"
                        );
                        expect(result.errors).toContain(
                                "Metadata createdAt must be a Date object"
                        );
                        expect(result.errors).toContain(
                                "Metadata updatedAt must be a Date object"
                        );
                        expect(result.errors).toContain(
                                "Metadata nextRun must be a Date object"
                        );
                        expect(result.errors).toContain(
                                "Metadata lastRun must be a Date object"
                        );
                        expect(result.errors).toContain(
                                "Metadata lastError must be an Error object"
                        );
                })
  })

  describe('validateTaskOptions', () => {
                it('should validate cron expression', () => {
                        const invalidOptions = {
                                ...validTask.options,
                                expression: 'invalid',
                        };
                        const result = TaskValidator.validateTaskOptions(invalidOptions)
      expect(result.valid).toBe(false)
      expect(result.errors[0]).toContain('Invalid cron expression')
    })

    it('should validate timezone', () => {
                        const validTimezone = {
                                ...validTask.options,
                                timezone: 'America/New_York',
                        };
                        const invalidTimezone = {
                                ...validTask.options,
                                timezone: 'Invalid/Timezone',
                        };

                        const result1 = TaskValidator.validateTaskOptions(validTimezone)
      expect(result1.valid).toBe(true)

      const result2 = TaskValidator.validateTaskOptions(invalidTimezone)
      expect(result2.valid).toBe(false)
      expect(result2.errors).toContain(
                                "Invalid timezone: Invalid/Timezone"
                        );
                })

    it('should validate retry options', () => {
                        const invalidRetry = {
                                ...validTask.options,
                                maxRetries: -1,
                                retryDelay: 50,
                        };

                        const result = TaskValidator.validateTaskOptions(invalidRetry)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain(
                                "maxRetries must be a non-negative integer"
                        );
                        expect(result.errors).toContain(
                                "retryDelay must be an integer >= 100ms"
                        );
                })

    it('should validate timeout', () => {
                        const invalidTimeout = {
                                ...validTask.options,
                                timeout: 500, // Less than minimum
                        };

                        const result = TaskValidator.validateTaskOptions(invalidTimeout)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain(
                                "timeout must be an integer >= 1000ms"
                        );
                })

    it('should validate boolean flags', () => {
                        const invalidFlags = {
                                ...validTask.options,
                                exclusive: 'true' as any,
                                catchUp: 1 as any,
                        };

                        const result = TaskValidator.validateTaskOptions(invalidFlags)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('exclusive must be a boolean')
      expect(result.errors).toContain('catchUp must be a boolean')
    })

    it('should validate maximum constraints', () => {
                        const exceedLimits = {
                                ...validTask.options,
                                maxRetries: 11,
                                retryDelay: 24 * 60 * 60 * 1000 + 1,
                                timeout: 25 * 60 * 60 * 1000,
                        };

                        const result = TaskValidator.validateTaskOptions(exceedLimits)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('maxRetries cannot exceed 10')
      expect(result.errors).toContain(
                                "retryDelay cannot exceed 3600000ms"
                        );
                        expect(result.errors).toContain('timeout cannot exceed 86400000ms')
    })
  })
})
