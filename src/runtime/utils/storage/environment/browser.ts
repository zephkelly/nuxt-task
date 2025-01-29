import type { CronJob } from '../../job/types';
import type { CronStorage, StorageConfig, BaseStorageConfig } from '../types';
import { BaseStorage } from './base';
import { MemoryStorage } from './memory';



export abstract class BrowserStorageBase extends BaseStorage implements CronStorage {
    protected abstract storage: Storage;

    async init(): Promise<void> { }

    async add(job: Omit<CronJob, 'id' | 'createdAt' | 'updatedAt'>): Promise<CronJob> {
        const newJob = this.createJobObject(job);
        this.storage.setItem(
            this.getKey(newJob.id),
            JSON.stringify(newJob)
        );
        return newJob;
    }

    async get(id: string): Promise<CronJob | null> {
        const data = this.storage.getItem(this.getKey(id));
        if (!data) return null;
        
        return JSON.parse(data);
    }

    async getAll(): Promise<CronJob[]> {
        const jobs: CronJob[] = [];
        
        for (let i = 0; i < this.storage.length; i++) {
            const key = this.storage.key(i);
            if (key?.startsWith(this.prefix)) {
                const data = this.storage.getItem(key);
                if (data) {
                    jobs.push(JSON.parse(data));
                }
            }
        }
        
        return jobs;
    }

    async update(id: string, updates: Partial<CronJob>): Promise<CronJob> {
        const job = await this.get(id);
        if (!job) {
            throw new Error(`Job with id ${id} not found`);
        }

        const updatedJob = this.updateJobObject(job, updates);
        this.storage.setItem(this.getKey(id), JSON.stringify(updatedJob));
        
        return updatedJob;
    }

    async remove(id: string): Promise<boolean> {
        const exists = await this.get(id);
        if (!exists) return false;
        
        this.storage.removeItem(this.getKey(id));
        return true;
    }

    async clear(): Promise<void> {
        for (let i = this.storage.length - 1; i >= 0; i--) {
            const key = this.storage.key(i);
            if (key?.startsWith(this.prefix)) {
                this.storage.removeItem(key);
            }
        }
    }
}



export class LocalStorage extends BrowserStorageBase {
    protected storage: Storage = localStorage;
    constructor(config?: BaseStorageConfig) {
        super(config);
    }
}

export class SessionStorage extends BrowserStorageBase {
    protected storage: Storage = sessionStorage;
    constructor(config?: BaseStorageConfig) {
        super(config);
    }
}

export async function createBrowserStorage(options: StorageConfig): Promise<CronStorage> {
    if (options.type === 'memory') {
        return new MemoryStorage();
    }
    
    if (options.type === 'localStorage') {
        const storage = new LocalStorage(options.config);
        await storage.init();
        return storage;
    }

    if (options.type === 'sessionStorage') {
        const storage = new SessionStorage(options.config);
        await storage.init();
        return storage;
    }

    throw new Error(`Storage type ${options.type} is not supported in browser environment`);
}