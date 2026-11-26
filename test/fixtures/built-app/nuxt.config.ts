// Consumes nuxt-task the way an app does: from node_modules, out of the
// packed dist/. test/build/native.build.ts installs it there before building.
// Loading ../../../src/module instead would hide bugs that only appear when
// the runtime is a dependency (Nitro does not auto-import into node_modules).
export default defineNuxtConfig({
    modules: ['nuxt-task'],
    compatibilityDate: '2025-01-28',
    devtools: { enabled: false },
    nuxtTask: {
        experimental: {
            tasks: true,
        },
    },
})
