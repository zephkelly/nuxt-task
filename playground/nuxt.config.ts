export default defineNuxtConfig({
    modules: ['../src/module'],
    devtools: { enabled: true },
    compatibilityDate: '2025-01-28',

    nuxtTask: {
        experimental: {
            tasks: true
        },
    },
    
    typescript: {
        strict: true,
    }
})
