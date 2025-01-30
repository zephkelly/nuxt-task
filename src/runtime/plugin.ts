import { defineNuxtPlugin, useRuntimeConfig } from '#app'
import { setModuleOptions } from './utils/config'
import type { ModuleOptions } from '../module'



export default defineNuxtPlugin((nuxtApp) => {
    const config = useRuntimeConfig()
    
    const cronConfig = config.cron as ModuleOptions
    setModuleOptions(cronConfig)
})
