import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { Scheduler } from './../../src/runtime/utils/scheduler';
import { MemoryStorage } from './../../src/runtime/utils/storage/environment/memory';
import type { CronJob, JobEvent } from './../../src/runtime/utils/job/types';



describe('Scheduler', () => {
    let scheduler: Scheduler;
    let storage: MemoryStorage;

    beforeEach(async () => {
        // Create new storage instance
        storage = new MemoryStorage();
        await storage.init();

        // Spy on the prototype methods
        vi.spyOn(MemoryStorage.prototype, 'add');
        vi.spyOn(MemoryStorage.prototype, 'update');
        vi.spyOn(MemoryStorage.prototype, 'get');
        vi.spyOn(MemoryStorage.prototype, 'getAll');

        scheduler = new Scheduler(storage, {
            tickInterval: 100,
            maxConcurrent: 2
        });
    });

    afterEach(async () => {
        await scheduler.stop();
        vi.clearAllMocks();
        vi.restoreAllMocks();
    });

    describe('job management', () => {
        it('should add a new job', async () => {
            const job = await scheduler.addJob({
                name: 'test job',
                status: 'pending',
                options: {
                    expression: '* * * * *'
                },
                execute: async () => 'test result'
            });

            expect(storage.add).toHaveBeenCalled();
            expect(job).toMatchObject({
                name: 'test job',
                options: {
                    expression: '* * * * *'
                },
                id: expect.any(String)
            });
        });
    });

    describe('job execution', () => {
        it('should handle job failures and retries', async () => {
            let attempts = 0;
            const failureError = new Error('test failure');
        
            const testJob: CronJob = {
                id: 'test-id',
                name: 'failing job',
                status: 'pending',
                options: {
                    expression: '* * * * *',
                    maxRetries: 1,
                    retryDelay: 100
                },
                execute: async () => {
                    attempts++;
                    throw failureError;
                },
                metadata: {
                    runCount: 0,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    nextRun: new Date(Date.now() - 1000)
                }
            };
        
            // Mock storage methods
            vi.spyOn(storage, 'getAll').mockResolvedValue([testJob]);
            vi.spyOn(storage, 'get').mockResolvedValue(testJob);
            vi.spyOn(storage, 'update').mockImplementation(async (id, updates) => ({
                ...testJob,
                ...updates,
                id
            }));
        
            // Collect events
            const events: JobEvent[] = [];
            scheduler.on('job-failed', (event) => events.push(event));
            scheduler.on('job-retry', (event) => events.push(event));
        
            await scheduler.start();
        
            // Wait for job execution to complete
            await new Promise(resolve => setTimeout(resolve, 500));
        
            // Explicitly stop the scheduler to prevent more retries
            await scheduler.stop();
        
            expect(attempts).toBe(2); // Initial attempt + 1 retry
            expect(events.filter(e => e.type === 'retry')).toHaveLength(1);
            expect(events.filter(e => e.type === 'failed')).toHaveLength(1);
        });
    });

    describe('error handling', () => {
        it('should emit error events', async () => {
            const errorHandler = vi.fn();
            scheduler.on('error', errorHandler);

            await scheduler.addJob({
                name: 'test job',
                status: 'pending',
                options: {
                    expression: 'invalid cron'
                },
                execute: async () => 'test'
            }).catch(() => {/* ignore error */});

            expect(errorHandler).toHaveBeenCalled();
        });
    });
});