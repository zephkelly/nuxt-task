import { defineTaskHandler } from '#nuxt-task'

// Path name `habit:demo`, meta.name `habit-demo`: runs must use the path name.
// Six fields (every second), which Nitro's croner accepts, so a scheduled run
// arrives within seconds of boot.
export default defineTaskHandler({
    meta: {
        name: 'habit-demo',
        description: 'Scheduled task whose meta.name differs from its path',
    },
    schedule: '* * * * * *',
    handler: async () => {
        return { ok: true }
    },
})
