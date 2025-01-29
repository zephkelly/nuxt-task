import type { StorageConfig, CronStorage } from './types';
import { MemoryStorage } from './environments/memory';
import { RedisStorage } from './environments/redis';
import { LocalStorage, SessionStorage } from './environments/browser';

export * from './types';

const isBrowser = typeof window !== 'undefined';

export async function createStorage(options: StorageConfig): Promise<CronStorage> {
    let storage: CronStorage;

    switch (options.type) {
        case 'memory':
            storage = new MemoryStorage();
            break;
            
        case 'redis':
            if (isBrowser) {
                throw new Error('Redis storage is not available in browser environment');
            }
            storage = new RedisStorage(options.config);
            break;
            
        case 'localStorage':
            if (!isBrowser) {
                throw new Error('Local storage is only available in browser environment');
            }
            storage = new LocalStorage(options.config);
            break;
            
        case 'sessionStorage':
            if (!isBrowser) {
                throw new Error('Session storage is only available in browser environment');
            }
            storage = new SessionStorage(options.config);
            break;
            
        default:
            throw new Error(`Unknown storage type: ${options.type}`);
    }

    await storage.init();
    return storage;
}