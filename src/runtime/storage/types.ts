import type { CronTask } from '../task/types'

import type { BaseStorageConfig } from './environments/base'



export type BackendStorageType = 'memory' | 'redis' | 'database'
export type FrontendStorageType = 'memory' | 'sessionStorage' | 'localStorage'

export type StorageType = BackendStorageType | FrontendStorageType

export interface DatabaseConfig extends BaseStorageConfig {
    url: string
    type: 'mysql' | 'postgres' | 'sqlite'
}

export type StorageConfig =
    | { type: 'memory' }
    | { type: 'database', config: DatabaseConfig }
    | { type: 'sessionStorage' | 'localStorage', config?: BaseStorageConfig }

export interface CronStorage {
    init(): Promise<void>
    add(Task: Omit<CronTask, 'id' | 'createdAt' | 'updatedAt'>): Promise<CronTask>
    get(id: string): Promise<CronTask | null>
    getAll(): Promise<CronTask[]>
    update(id: string, Task: Partial<CronTask>): Promise<CronTask>
    remove(id: string): Promise<boolean>
    clear(): Promise<void>
}