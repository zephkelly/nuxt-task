import nuxtCron, { type ModuleOptions } from '../../../src/module'

const cronConfig: ModuleOptions = {
        experimental: {
                tasks: true,
        },
        serverTasks: true,
        storage: {
                type: 'memory',
        },
        timezone: {
                type: 'UTC',
                validate: true,
                strict: false,
        },
}

export default defineNuxtConfig({
        modules: [nuxtCron],
        // Use the module's real config key so experimental (native) mode engages.
        nuxtTask: cronConfig,
        nitro: {
                experimental: {
                        tasks: true,
                },
        },
})
