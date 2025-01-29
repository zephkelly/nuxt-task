import type { StorageConfig, CronStorage } from './types';



export async function createStorage(options: StorageConfig): Promise<CronStorage> {
    if (options.type === 'memory') {
        return (await import('./environment/memory')).createMemoryStorage();
    }
   
    if (options.type === 'localStorage' || options.type === 'sessionStorage') {
        const browserModule = await import('./environment/browser');
        return browserModule.createBrowserStorage(options);
    }

    throw new Error(`Storage type ${options.type} is not supported in browser environment`);
}