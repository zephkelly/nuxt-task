import type { ModuleOptions } from './module'


declare module '#nuxt-cron' {
    export * from './runtime/types'
    export * from './runtime/server/nitro/handler'
    export type { ModuleOptions } from './module'
}
  

declare module '@nuxt/schema' {
    interface NuxtConfig {
        cron?: ModuleOptions
        runtimeConfig: {
            public: {
                cron: ModuleOptions
            }
        }
    }

    interface NuxtOptions {
        cron?: ModuleOptions
        runtimeConfig: {
            public: {
                cron: ModuleOptions
            }
        }
    }

    interface RuntimeConfig {
        cron: ModuleOptions
        public: {
            cron: ModuleOptions
        }
    }
}

declare module 'nuxt/schema' {
    interface NuxtConfig {
        cron?: ModuleOptions
        runtimeConfig: {
            public: {
                cron: ModuleOptions
            }
        }
    }

    interface NuxtOptions {
        cron?: ModuleOptions
        runtimeConfig: {
            public: {
                cron: ModuleOptions
            }
        }
    }

    interface RuntimeConfig {
        public: {
            cron: ModuleOptions
        }
    }
}