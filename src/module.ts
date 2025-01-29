import { defineNuxtModule, addPlugin, createResolver } from '@nuxt/kit'
import { type StorageType } from './runtime/utils/storage'



export interface ModuleOptions {
    serverJobs?: boolean
    clientJobs?: boolean

    storage: {
        type: StorageType;
        config?: Record<string, any>;
    };

    timezone?: string;
    validateTimezone?: boolean;
}

export default defineNuxtModule<ModuleOptions>({
    meta: {
        name: 'nuxt-cron',
        configKey: 'cron',
        compatibility: {
            nuxt: '^3.10.0 || ^4.0.0',
        }
    },
    defaults: {
        serverJobs: true,
        clientJobs: false,

        storage: {
            type: 'memory'
        },

        timezone: 'UTC',
        validateTimezone: true,
    },
    setup(_options, _nuxt) {
        const resolver = createResolver(import.meta.url)
        _nuxt.options.build.transpile.push(resolver.resolve('./runtime'));

        addPlugin({
            src: resolver.resolve('./runtime/plugin'),
        })
    },
})
