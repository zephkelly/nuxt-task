import { defineTaskHandler } from '#nuxt-cron'



export default defineTaskHandler({
    meta: {
        name: 'example',
        description: 'Example task for testing',
    },
    schedule: '* * * * *',
    options: {
        timezone: 'EST'
    },
    handler: async (ctx) => {

        console.log('Example task executed')

        return {
            message: 'Example task executed'
        }
    }
})