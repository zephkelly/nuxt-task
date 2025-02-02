import type { ModuleOptions } from './module'


declare module '@nuxt/runtime' {
    interface RuntimeConfig {
        cron: ModuleOptions
    }
}

declare module '@nuxt/schema' {
    interface ConfigSchema {
        cron?: ModuleOptions
    }

    interface NuxtConfig {
        cron?: ModuleOptions
    }
    interface NuxtOptions {
        cron?: ModuleOptions
    }
}

declare module 'nuxt/schema' {
    interface ConfigSchema {
        cron?: ModuleOptions
    }

    interface NuxtConfig {
        cron?: ModuleOptions
    }
    interface NuxtOptions {
        cron?: ModuleOptions
    }
}