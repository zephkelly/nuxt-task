import { moduleConfiguration } from '../../src/runtime/config'

/**
 * Stands in for `nitropack/dist/runtime/config`, which only loads inside a
 * Nitro build (it reads a virtual module and process.env.RUNTIME_CONFIG).
 * A real app's runtime config carries the module options under `nuxtTask`,
 * so this reports whatever the test set on the module singleton.
 */
export function useRuntimeConfig(): Record<string, any> {
    return { nuxtTask: moduleConfiguration.getModuleOptions() }
}

export function useAppConfig(): Record<string, any> {
    return {}
}
