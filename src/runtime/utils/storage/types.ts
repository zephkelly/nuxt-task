import type { CronJob }  from '../job/types';



export type BackendStorageType = 'memory' | 'redis' | 'database';
export type FrontendStorageType = 'memory' | 'sessionStorage' | 'localStorage';

export type StorageType = BackendStorageType | FrontendStorageType;


export interface BaseStorageConfig {
    prefix?: string;
}

export interface RedisConfig extends BaseStorageConfig {
    url: string;
    password?: string;
    database?: number;
}

export interface DatabaseConfig extends BaseStorageConfig {
    url: string;
    type: 'mysql' | 'postgres' | 'sqlite';
}

export type StorageConfig = 
    | { type: 'memory' } 
    | { type: 'redis'; config: RedisConfig }
    | { type: 'database'; config: DatabaseConfig }
    | { type: 'sessionStorage' | 'localStorage'; config?: BaseStorageConfig };


export interface CronStorage {
    init(): Promise<void>;
    add(job: Omit<CronJob, 'id' | 'createdAt' | 'updatedAt'>): Promise<CronJob>;
    get(id: string): Promise<CronJob | null>;
    getAll(): Promise<CronJob[]>;
    update(id: string, job: Partial<CronJob>): Promise<CronJob>;
    remove(id: string): Promise<boolean>;
    clear(): Promise<void>;
}