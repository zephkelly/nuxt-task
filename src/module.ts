import { defineNuxtModule, addPlugin, createResolver } from '@nuxt/kit'

// Module options TypeScript interface definition
export interface ModuleOptions {
    serverJobs?: boolean
    clientJobs?: boolean
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
        clientJobs: false
    },
    setup(_options, _nuxt) {
        const resolver = createResolver(import.meta.url)

        // Do not add the extension since the `.ts` will be transpiled to `.mjs` after `npm run prepack`
        addPlugin(resolver.resolve('./runtime/plugin'))
    },
})
