import { defineNuxtModule, addPlugin, createResolver } from '@nuxt/kit'
import { type StorageType } from './runtime/utils/storage'


// Module options TypeScript interface definition
export interface ModuleOptions {
    serverJobs?: boolean
    clientJobs?: boolean

    storage: {
        type: StorageType;
        config?: Record<string, any>;
    };
}

export default defineNuxtModule<ModuleOptions>({
    meta: {
        name: 'nuxt-cron',
        configKey: 'cron',
        compatibility: {
            nuxt: '^3.10.0 || ^4.0.0',
        }
    },
    // Default configuration options of the Nuxt module
    defaults: {
        serverJobs: true,
        clientJobs: false,

        storage: {
            type: 'memory'
        },
    },
    setup(_options, _nuxt) {
        const resolver = createResolver(import.meta.url)

        _nuxt.options.build.transpile.push(resolver.resolve('./runtime'));

        addPlugin(resolver.resolve('./runtime/plugin'))
    },
})
