import { defineNuxtPlugin, useRuntimeConfig } from '#app'
import { setModuleOptions } from './config'
import { type ModuleOptions } from '../module'



export default defineNuxtPlugin((nuxtApp: any) => {
    const config = useRuntimeConfig()
    const cronConfig = config.public
})
