import type { StorageConfig, CronStorage } from './types'



export async function createServerStorage(options: StorageConfig): Promise<CronStorage> {
    if (options.type === 'memory') {
        return (await import('./environments/memory')).createMemoryStorage()
    }

    if (options.type === 'redis') {
        const { createRedisStorage } = await import('./environments/redis')
        return createRedisStorage(options.config)
    }

    throw new Error(`Storage type ${options.type} is not supported in server environment`)
}