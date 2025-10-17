export default defineNuxtConfig({
    modules: ['../src/module'],
    devtools: { enabled: true },
    compatibilityDate: '2025-01-28',

    nuxtTask: {
        experimental: {
            tasks: false,
        },
    },

    typescript: {
        strict: true,
    }
})
