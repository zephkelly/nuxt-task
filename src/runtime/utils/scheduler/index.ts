import { EventEmitter } from 'events';
import type { CronJob, JobEvent, JobId } from '../job/types';
import type { CronStorage, StorageConfig } from '../storage/types';
import type { SchedulerEvents, SchedulerOptions, SchedulerStats } from './types';
import { JobQueue } from '../queue';
import { parseCronExpression, type ParsedCron } from './../parser';



export class Scheduler extends EventEmitter {
    private queue: JobQueue;
    private storage: CronStorage;
    private intervalId?: NodeJS.Timeout;
    private running: boolean = false;
    private startTime?: Date;
    private stats: SchedulerStats = {
        totalJobsRun: 0,
        totalJobsFailed: 0,
        totalJobsRetried: 0,
        activeJobs: 0,
        queuedJobs: 0,
        uptime: 0
    };
  
    constructor(
        storage: CronStorage,
        private options: SchedulerOptions = {}
    ) {
        super();
        this.queue = new JobQueue();
        this.storage = storage;
    
        this.options = {
            tickInterval: 1000,
            maxConcurrent: 10,
            defaultRetryOptions: {
                maxRetries: 3,
                retryDelay: 1000
            },
            defaultTimeout: 30000,
            handleMissedJobs: true,
            ...options
        };
    
        this.setupEventForwarding();
    }
  
    private setupEventForwarding(): void {
        type QueueEventType = JobEvent['type'];
        type SchedulerEventType = `job-${QueueEventType}`;
        
        const eventMapping: Record<QueueEventType, SchedulerEventType> = {
            started: 'job-started',
            completed: 'job-completed',
            failed: 'job-failed',
            retry: 'job-retry',
            paused: 'job-paused',
            resumed: 'job-resumed'
        } as const;
      
        Object.entries(eventMapping).forEach(([queueEvent, schedulerEvent]) => {
            this.queue.on(queueEvent as QueueEventType, (event: JobEvent) => {
                switch (event.type) {
                case 'completed':
                    this.updateJobNextRun(event.job);
                    break;
                case 'failed':
                    this.stats.totalJobsFailed++;
                    break;
                case 'retry':
                    this.stats.totalJobsRetried++;
                    break;
                case 'started':
                    this.stats.totalJobsRun++;
                    break;
                }
                this.emit(schedulerEvent, event);
            });
        });
    }

    protected handleError(method: string, error: unknown): Error {
        if (error instanceof Error) {
            return new Error(`${method}: ${error.message}`);
        }
        return new Error(`${method}: An unknown error occurred`);
    }


    async start(): Promise<void> {
        if (this.running) return;
    
        try {
            await this.storage.init();
            await this.restore();
        
            this.running = true;
            this.startTime = new Date();
            this.intervalId = setInterval(() => this.tick(), this.options.tickInterval);
        
            if (this.options.handleMissedJobs) {
                await this.handleMissedJobs();
            }
        }
        catch (error: unknown) {
            const wrappedError = this.handleError('Failed to start scheduler', error);
            this.emit('error', wrappedError);
            throw wrappedError;
        }
    }


    async stop(): Promise<void> {
        if (!this.running) return;
    
        try {
            this.running = false;
            if (this.intervalId) {
                clearInterval(this.intervalId);
            }
        
            // Wait for active jobs to complete
            const activeJobs = this.queue.getAll().filter(job => 
                job.status === 'running'
            );
        
            if (activeJobs.length > 0) {
                await Promise.all(
                activeJobs.map(job => this.waitForJob(job.id))
                );
            }
        
            await this.persist();
        }
        catch (error: unknown) {
            const wrappedError = this.handleError('Failed to stop scheduler', error);
            this.emit('error', wrappedError);
            throw wrappedError;
        }
    }


    async addJob(job: Omit<CronJob, 'id' | 'metadata'>): Promise<CronJob> {
        try {
            // Validate cron expression
            parseCronExpression(job.options.expression);
        
            // Create job with metadata
            const newJob: CronJob = {
                ...job,
                id: crypto.randomUUID(),
                metadata: {
                    runCount: 0,
                    createdAt: new Date(),
                    updatedAt: new Date()
                }
            };
        
            newJob.metadata.nextRun = this.getNextRunTime(newJob);
        
            this.queue.add(newJob);
            await this.persist();
        
            return newJob;
        }
        catch (error: unknown) {
            const wrappedError = this.handleError('Failed to add job', error);
            this.emit('error', wrappedError);
            throw wrappedError;
        }
    }


    async removeJob(jobId: JobId): Promise<void> {
        const removed = this.queue.remove(jobId);

        if (removed) {
            await this.persist();
        }
    }


    async pauseJob(jobId: JobId): Promise<void> {
        this.queue.pause(jobId);
        await this.persist();
    }


    async resumeJob(jobId: JobId): Promise<void> {
        const job = this.queue.get(jobId);

        if (job && job.status === 'paused') {
            this.queue.resume(jobId);
            job.metadata.nextRun = this.getNextRunTime(job);
            await this.persist();
        }
    }


    getJob(jobId: JobId): CronJob | undefined {
        return this.queue.get(jobId);
    }


    getAllJobs(): CronJob[] {
        return this.queue.getAll();
    }


    getStats(): SchedulerStats {
        if (this.startTime) {
            this.stats.uptime = Date.now() - this.startTime.getTime();
        }

        return { ...this.stats };
    }


    private waitForJob(jobId: JobId): Promise<void> {
        return new Promise((resolve) => {
            const checkCompletion = () => {
                const job = this.queue.get(jobId);

                if (!job || job.status !== 'running') {
                    resolve();
                }
                else {
                    setTimeout(checkCompletion, 100);
                }
            };

            checkCompletion();
        });
    }


    private getNextRunTime(job: CronJob): Date {
        try {
            const parsed = parseCronExpression(job.options.expression);
            return this.calculateNextRunTime(parsed);
        }
        catch (error: unknown) {
            const wrappedError = this.handleError(`Invalid cron expression for job ${job.id}`, error);
            this.emit('error', wrappedError);
            return new Date(Date.now() + 24 * 60 * 60 * 1000);
        }
    }


    private calculateNextRunTime(parsed: ParsedCron): Date {
        const now = new Date();
        let candidate = new Date(now);
        
        candidate.setSeconds(0);
        candidate.setMilliseconds(0);
        
        while (true) {
            const minute = candidate.getMinutes();
            const hour = candidate.getHours();
            const dayOfMonth = candidate.getDate();
            const month = candidate.getMonth() + 1; // JavaScript months are 0-based
            const dayOfWeek = candidate.getDay();

            if (
                parsed.minute.includes(minute) &&
                parsed.hour.includes(hour) &&
                parsed.dayOfMonth.includes(dayOfMonth) &&
                parsed.month.includes(month) &&
                parsed.dayOfWeek.includes(dayOfWeek) &&
                candidate > now
            ) {
                return candidate;
            }

            candidate.setMinutes(candidate.getMinutes() + 1);
        }
    }


    private async tick(): Promise<void> {
        if (!this.running) return;
    
        try {
            const now = new Date();
            this.updateStats();
        
            const jobs = this.queue.getAll();
            const jobsToRun = jobs.filter(job =>
                job.status !== 'paused' &&
                job.metadata.nextRun &&
                job.metadata.nextRun <= now &&
                !this.queue.isRunning(job.id)
            );
        
            // Execute jobs up to maxConcurrent limit
            const currentRunning = jobs.filter(job => 
                job.status === 'running'
            ).length;
        
            const available = Math.max(
                0,
                this.options.maxConcurrent! - currentRunning
            );
        
            const toExecute = jobsToRun.slice(0, available);
        
            await Promise.all(
                toExecute.map(job => this.queue.executeJob(job.id))
            );  
        }
        catch (error: unknown) {
            const wrappedError = this.handleError('Scheduler tick failed', error);
            this.emit('error', wrappedError);
        }
    }


    private updateJobNextRun(job: CronJob): void {
        job.metadata.nextRun = this.getNextRunTime(job);

        this.persist().catch((error: unknown) => {
            const wrappedError = this.handleError('Failed to persist job state', error);
            this.emit('error', wrappedError);
        });
    }


    private async handleMissedJobs(): Promise<void> {
        try {
            const now = new Date();
            const jobs = this.queue.getAll();

            for (const job of jobs) {
                if (
                    job.options.catchUp &&
                    job.metadata.nextRun &&
                    job.metadata.nextRun < now
                ) {
                    await this.queue.executeJob(job.id);
                    job.metadata.nextRun = this.getNextRunTime(job);
                }
            }
        }
        catch (error: unknown) {
            const wrappedError = this.handleError('Failed to handle missed jobs', error);
            this.emit('error', wrappedError);
            throw wrappedError;
        }
    }


    private updateStats(): void {
        this.stats.activeJobs = this.queue.getAll().filter(
            job => job.status === 'running'
        ).length;
        
        this.stats.queuedJobs = this.queue.getAll().filter(
            job => job.status === 'pending'
        ).length;
    }


    /**
     * Persist scheduler state to storage
     */
    private async persist(): Promise<void> {
        try {
            const jobs = this.queue.getAll();
            await Promise.all(jobs.map(async job => {
                const existingJob = await this.storage.get(job.id);
                
                if (existingJob) {
                    await this.storage.update(job.id, job);
                }
                else {
                    await this.storage.add(job);
                }
            }));
        }
        catch (error: unknown) {
            const wrappedError = this.handleError('Failed to persist scheduler state', error);
            this.emit('error', wrappedError);
            throw wrappedError;
        }
    }

    /**
     * Restore scheduler state from storage
     */
    private async restore(): Promise<void> {
        try {
            const jobs = await this.storage.getAll();
            jobs.forEach(job => this.queue.add(job));
        }
        catch (error: unknown) {
            const wrappedError = this.handleError('Failed to restore scheduler state', error);
            this.emit('error', wrappedError);
            throw wrappedError;
        }
    }
}