import type { ModuleOptions } from './module'

import type { Scheduler } from './runtime/scheduler'

declare module '#nuxt-task' {
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
            cron: ModuleOptions
        }
    }

    interface RuntimeConfig {
        cron: ModuleOptions
    }
}

declare module 'nuxt/schema' {
    interface NuxtConfig {
        cron?: ModuleOptions
        runtimeConfig: {
            cron: ModuleOptions
        }
    }

    interface NuxtOptions {
        cron?: ModuleOptions
        runtimeConfig: {
            cron: ModuleOptions
        }
    }

    interface RuntimeConfig {
        cron: ModuleOptions
    }
}

declare module '@nuxt/kit' {
    interface NuxtAppOptions {
        scheduler: Scheduler
    }
}



export {}