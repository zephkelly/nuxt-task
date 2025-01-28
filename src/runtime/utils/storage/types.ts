export interface CronJob {
    id: string;
    name: string;
    expression: string;
    callback: string; // Serialized function or path to function
    enabled: boolean;
    lastRun?: Date;
    nextRun?: Date;
    createdAt: Date;
    updatedAt: Date;
}
  

export type StorageType = 'memory' | 'redis' | 'database';

export interface CronStorage {
    init(): Promise<void>;
    add(job: Omit<CronJob, 'id' | 'createdAt' | 'updatedAt'>): Promise<CronJob>;
    get(id: string): Promise<CronJob | null>;
    getAll(): Promise<CronJob[]>;
    update(id: string, job: Partial<CronJob>): Promise<CronJob>;
    remove(id: string): Promise<boolean>;
    clear(): Promise<void>;
}