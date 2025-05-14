export default defineNuxtConfig({
    modules: ['../src/module'],
    devtools: { enabled: true },
    compatibilityDate: '2025-01-28',

    cron: {
        experimental: {
            tasks: false
        },
    },
    
    debug: true,
    typescript: {
        strict: true,
    }
})
