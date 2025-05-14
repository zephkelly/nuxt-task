import { defineTaskHandler } from '#nuxt-cron'



export default defineTaskHandler({
    meta: {
        name: 'example',
        description: 'Example task for testing',
    },
    schedule: '* * * * *',
    handler: async (ctx) => {

        console.log('Example task executed')

        return {
            message: 'Example task executed'
        }
    }
})