import { defu } from 'defu'
import { defineNuxtModule, addPlugin, createResolver } from '@nuxt/kit'
import type { StorageType } from './runtime/utils/storage'

import type { FlexibleTimezoneOptions, StrictTimezoneOptions } from './runtime/utils/timezone'

import { defaultModuleOptions, setModuleOptions } from './runtime/utils/config'



interface BaseModuleOptions {
    serverJobs?: boolean
    clientJobs?: boolean
    storage: {
        type: StorageType
        config?: Record<string, any>
    }
}

export interface FlexibleTimezoneModuleOptions extends BaseModuleOptions {
    timezone: FlexibleTimezoneOptions
}

export interface StrictTimezoneModuleOptions extends BaseModuleOptions {
    timezone: StrictTimezoneOptions
}

export type ModuleOptions = FlexibleTimezoneModuleOptions | StrictTimezoneModuleOptions



export default defineNuxtModule<ModuleOptions>({
    meta: {
        name: 'nuxt-cron',
        configKey: 'cron',
        compatibility: {
            nuxt: '^3.10.0 || ^4.0.0',
        },
    },
    defaults: defaultModuleOptions,
    setup(_options, _nuxt) {
        const resolver = createResolver(import.meta.url)

        setModuleOptions(_options)
        
        _nuxt.options.runtimeConfig.cron = defu(
            _nuxt.options.runtimeConfig.cron,
            _options
        ) as ModuleOptions

        addPlugin({
            src: resolver.resolve('./runtime/plugin'),
        })
    },
})
