import { defu } from 'defu'
import type { ModuleOptions } from './../../module'



declare module '@nuxt/schema' {
    interface RuntimeConfig {
        cron: ModuleOptions
    }
}


export const defaultModuleOptions: ModuleOptions = {
    serverJobs: true,
    clientJobs: false,
    storage: {
        type: 'memory',
    },
    timezone: {
        type: 'UTC',
        validate: true,
        strict: false,
    },
}

let moduleOptions: ModuleOptions = defaultModuleOptions

export function setModuleOptions(options: ModuleOptions) {
    moduleOptions = defu(options, defaultModuleOptions) as ModuleOptions
}

export function updateModuleOptions(options: Partial<ModuleOptions>) {
    moduleOptions = defu(options, moduleOptions) as ModuleOptions
}

export function getModuleOptions(): ModuleOptions {
    return moduleOptions
}

export function resetModuleOptions() {
    moduleOptions = defaultModuleOptions
}

export function validateModuleOptions(options: ModuleOptions): boolean {
    if (!options.timezone?.type) {
        return false
    }
    
    if (options.timezone.strict && options.timezone.type !== moduleOptions.timezone.type) {
        return false
    }
    
    return true
}