import { describe, it, expect, beforeEach } from 'vitest'


describe('MemoryStorage', () => {
    let MemoryStorage: any
    let storage: any

    beforeEach(async () => {
        const module = await import('../../src/runtime/utils/storage/environment/memory')
        MemoryStorage = module.MemoryStorage
        storage = new MemoryStorage()
    })

    describe('add', () => {
        it('should add a new job with generated id and timestamps', async () => {
            const jobData = {
                name: 'Test Job',
                expression: '* * * * *',
                callback: 'console.log("test")',
                enabled: true
            }

            const job = await storage.add(jobData)

            expect(job).toMatchObject({
                ...jobData,
                id: expect.any(String),
                metadata: {
                    runCount: 0,
                    createdAt: expect.any(Date),
                    updatedAt: expect.any(Date)
                }
            })
        })
    })

    describe('update', () => {
        it('should update an existing job', async () => {
            const jobData = {
                name: 'Test Job',
                expression: '* * * * *',
                callback: 'console.log("test")',
                enabled: true
            }

            const job = await storage.add(jobData)
            const originalUpdatedAt = job.metadata.updatedAt

            await new Promise(resolve => setTimeout(resolve, 1))

            const updates = {
                name: 'Updated Job',
                enabled: false
            }

            const updatedJob = await storage.update(job.id, updates)

            expect({
                ...updatedJob,
                metadata: {
                    ...updatedJob.metadata,
                    updatedAt: job.metadata.updatedAt
                }
            }).toMatchObject({
                ...job,
                ...updates
            })

            // Separately verify the updatedAt timestamp is newer
            expect(updatedJob.metadata.updatedAt.getTime()).toBeGreaterThan(job.metadata.updatedAt.getTime())
            expect(updatedJob.metadata.updatedAt.getTime()).toBeGreaterThan(originalUpdatedAt.getTime())
        })
    })

    describe('get', () => {
        it('should retrieve an existing job', async () => {
            const jobData = {
                name: 'Test Job',
                expression: '* * * * *',
                callback: 'console.log("test")',
                enabled: true
            }

            const addedJob = await storage.add(jobData)
            const retrievedJob = await storage.get(addedJob.id)

            expect(retrievedJob).toEqual(addedJob)
        })

        it('should return null for non-existent job', async () => {
            const result = await storage.get('non-existent-id')
            expect(result).toBeNull()
        })
    })

    describe('getAll', () => {
        it('should return empty array when no jobs exist', async () => {
            const jobs = await storage.getAll()
            expect(jobs).toEqual([])
        })

        it('should return all added jobs', async () => {
            const jobData1 = {
                name: 'Test Job 1',
                expression: '* * * * *',
                callback: 'console.log("test1")',
                enabled: true
            }

            const jobData2 = {
                name: 'Test Job 2',
                expression: '*/5 * * * *',
                callback: 'console.log("test2")',
                enabled: false
            }

            const job1 = await storage.add(jobData1)
            const job2 = await storage.add(jobData2)

            const allJobs = await storage.getAll()
            expect(allJobs).toHaveLength(2)
            expect(allJobs).toEqual(expect.arrayContaining([job1, job2]))
        })
    })

    describe('concurrent operations', () => {
        it('should handle multiple simultaneous updates to the same job', async () => {
            const job = await storage.add({
                name: 'Test Job',
                expression: '* * * * *',
                callback: 'console.log("test")',
                enabled: true
            });
    
            // Simulate concurrent updates
            const updates = await Promise.all([
                storage.update(job.id, { name: 'Update 1' }),
                storage.update(job.id, { name: 'Update 2' }),
                storage.update(job.id, { name: 'Update 3' })
            ]);
    
            const finalJob = await storage.get(job.id);
            expect(updates.some(u => u.name === finalJob?.name)).toBe(true);
        });
    });

    describe('edge cases', () => {
        it('should handle empty strings in job properties', async () => {
            const job = await storage.add({
                name: '',
                expression: '* * * * *',
                callback: '',
                enabled: true
            });
            
            expect(job.name).toBe('');
            expect(job.callback).toBe('');
        });
    
        it('should handle extremely long job names and callbacks', async () => {
            const longString = 'a'.repeat(10000);
            const job = await storage.add({
                name: longString,
                expression: '* * * * *',
                callback: longString,
                enabled: true
            });
            
            expect(job.name).toBe(longString);
            expect(job.callback).toBe(longString);
        });
    
        it('should handle special characters in job properties', async () => {
            const job = await storage.add({
                name: '!@#$%^&*()',
                expression: '* * * * *',
                callback: 'console.log("⚡️🎉")',
                enabled: true
            });
            
            const retrieved = await storage.get(job.id);
            expect(retrieved).toEqual(job);
        });
    });

    describe('date handling', () => {
        it('should handle invalid dates in lastRun and nextRun', async () => {
            const job = await storage.add({
                name: 'Test Job',
                expression: '* * * * *',
                callback: 'console.log("test")',
                enabled: true,
                metadata: {
                    lastRun: new Date('invalid date'),
                    nextRun: new Date('invalid date')
                }
            })
            
            expect(job.metadata.lastRun).toBeUndefined()
            expect(job.metadata.nextRun).toBeUndefined()
        })

        it('should handle undefined dates', async () => {
            const job = await storage.add({
                name: 'Test Job',
                expression: '* * * * *',
                callback: 'console.log("test")',
                enabled: true,
                metadata: {
                    lastRun: undefined,
                    nextRun: undefined
                }
            })
            
            expect(job.metadata.lastRun).toBeUndefined()
            expect(job.metadata.nextRun).toBeUndefined()
        })

        it('should handle date updates from valid to invalid', async () => {
            const validDate = new Date()
            const job = await storage.add({
                name: 'Test Job',
                expression: '* * * * *',
                callback: 'console.log("test")',
                enabled: true,
                metadata: {
                    lastRun: validDate,
                    nextRun: validDate
                }
            })

            const updatedJob = await storage.update(job.id, {
                metadata: {
                    lastRun: new Date('invalid date'),
                    nextRun: new Date('invalid date')
                }
            })

            expect(updatedJob.metadata.lastRun).toBeUndefined()
            expect(updatedJob.metadata.nextRun).toBeUndefined()
        })

        it('should preserve existing valid dates when updating with invalid dates', async () => {
            const validDate = new Date()
            const job = await storage.add({
                name: 'Test Job',
                expression: '* * * * *',
                callback: 'console.log("test")',
                enabled: true,
                metadata: {
                    lastRun: validDate,
                    nextRun: validDate
                }
            })

            const updatedJob = await storage.update(job.id, {
                metadata: {
                    lastRun: new Date('invalid date')
                }
            })

            expect(updatedJob.metadata.lastRun).toBeUndefined()
            expect(updatedJob.metadata.nextRun).toEqual(validDate)
        })
    })

    describe('bulk operations', () => {
        it('should handle adding many jobs simultaneously', async () => {
            const jobs = Array.from({ length: 1000 }, (_, i) => ({
                name: `Job ${i}`,
                expression: '* * * * *',
                callback: `console.log(${i})`,
                enabled: true
            }));
            
            const added = await Promise.all(jobs.map(job => storage.add(job)));
            expect(added).toHaveLength(jobs.length);
            
            const all = await storage.getAll();
            expect(all).toHaveLength(jobs.length);
        });
    
        it('should handle removing many jobs simultaneously', async () => {
            const jobs = await Promise.all(
                Array.from({ length: 100 }, (_, i) => storage.add({
                    name: `Job ${i}`,
                    expression: '* * * * *',
                    callback: `console.log(${i})`,
                    enabled: true
                }))
            );
            
            // Remove them all simultaneously
            await Promise.all(jobs.map(job => storage.remove(job.id)));
            
            const remaining = await storage.getAll();
            expect(remaining).toHaveLength(0);
        });
    });

    describe('remove', () => {
        it('should remove an existing job', async () => {
            const job = await storage.add({
                name: 'Test Job',
                expression: '* * * * *',
                callback: 'console.log("test")',
                enabled: true
            })

            const result = await storage.remove(job.id)
            expect(result).toBe(true)

            const retrievedJob = await storage.get(job.id)
            expect(retrievedJob).toBeNull()
        })

        it('should return false when removing non-existent job', async () => {
            const result = await storage.remove('non-existent-id')
            expect(result).toBe(false)
        })
    })

    describe('clear', () => {
        it('should remove all jobs', async () => {
            await storage.add({
                name: 'Test Job 1',
                expression: '* * * * *',
                callback: 'console.log("test1")',
                enabled: true
            })

            await storage.add({
                name: 'Test Job 2',
                expression: '*/5 * * * *',
                callback: 'console.log("test2")',
                enabled: false
            })

            await storage.clear()
            const jobs = await storage.getAll()
            expect(jobs).toHaveLength(0)
        })
    })
})