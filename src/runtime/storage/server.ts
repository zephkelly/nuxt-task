import type { StorageConfig, CronStorage } from './types'

export async function createServerStorage(
  options: StorageConfig,
): Promise<CronStorage> {
  if (options.type === 'memory') {
    return (await import('./environments/memory')).createMemoryStorage()
        }

  throw new Error(
    `Storage type ${options.type} is not supported in server environment`,
        );
}
