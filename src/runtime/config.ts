import { defu } from 'defu'
import { type ModuleOptions } from "./../module"



export const defaultModuleOptions: ModuleOptions = {
    serverTasks: true,
    clientTasks: false,
    experimental: {
        tasks: false
    },
    storage: {
        type: 'memory',
    },
    timezone: {
        type: 'UTC',
        validate: true,
        strict: false,
    },
} as const satisfies ModuleOptions

let moduleOptions: ModuleOptions = defaultModuleOptions

export function setModuleOptions(options: ModuleOptions) {
    moduleOptions = defu(options, defaultModuleOptions) as ModuleOptions
}

export function getModuleOptions(): ModuleOptions {
    return moduleOptions
}

export function resetModuleOptions() {
    moduleOptions = defaultModuleOptions
}

export function updateModuleOptions(options: Partial<ModuleOptions>) {
    moduleOptions = defu(options, moduleOptions) as ModuleOptions
}


export function validateModuleOptions(options: ModuleOptions): boolean {
    if (!options.timezone?.type) {
        return false
    }

    if (options.timezone.strict && options.timezone.type !== moduleOptions.timezone.type) {
        return false
    }

    if (options.experimental?.tasks && !options.serverTasks) {
        return false
    }

    return true
}