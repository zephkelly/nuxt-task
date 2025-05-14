import { defineTaskHandler } from '#nuxt-cron'



export default defineTaskHandler({
    meta: {
        name: 'migrate',
        description: 'Example task for testing',
    },
    schedule: '* 1 * * *',
    handler: async (ctx) => {
        return {
            result: {
                success: true,
                message: 'Example task executed'
            }
        }
    }
})