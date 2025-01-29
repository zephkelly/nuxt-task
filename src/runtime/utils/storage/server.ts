import type { StorageConfig, CronStorage } from './types';



export async function createStorage(options: StorageConfig): Promise<CronStorage> {
    if (options.type === 'memory') {
        return (await import('./environment/memory')).createMemoryStorage();
    }
   
    if (options.type === 'redis') {
        const { createRedisStorage } = await import('./environment/redis');
        return createRedisStorage(options.config);
    }

    throw new Error(`Storage type ${options.type} is not supported in server environment`);
}