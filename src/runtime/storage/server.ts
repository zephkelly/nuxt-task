import type { StorageConfig, CronStorage } from './types'

/** Backends with a real server-side implementation. */
const IMPLEMENTED: StorageConfig['type'][] = ['memory']

/** Backends advertised on StorageType that have no implementation yet. */
const UNIMPLEMENTED = ['redis', 'database']

export async function createServerStorage(
  options: StorageConfig,
): Promise<CronStorage> {
  if (IMPLEMENTED.includes(options.type)) {
    return (await import('./environments/memory')).createMemoryStorage()
        }

  // 'redis' and 'database' sit in the public StorageType union with nothing
  // behind them. Throwing took down boot for a config the types said was
  // valid, so fall back and say so instead.
  if (UNIMPLEMENTED.includes(options.type as string)) {
    console.warn(
      `[ nuxt-task ] Storage type "${options.type}" is not implemented yet. `
      + `Falling back to memory storage.`,
                )
    return (await import('./environments/memory')).createMemoryStorage()
        }

  throw new Error(
    `Storage type ${options.type} is not supported in server environment`,
        );
}
