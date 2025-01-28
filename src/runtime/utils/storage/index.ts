import { type CronStorage } from './types';
import { MemoryStorage } from './memory';

import { type StorageType } from './types';
export { type StorageType } from './types';


export interface StorageOptions {
    type: StorageType;
    config?: Record<string, any>;
}

export function createStorage(options: StorageOptions): CronStorage {
    switch (options.type) {
        case 'memory':
            return new MemoryStorage();
        case 'redis':
            throw new Error('Redis storage not implemented');
        case 'database':
            throw new Error('Database storage not implemented');
        default:
            throw new Error(`Unknown storage type: ${options.type}`);
    }
}