import { defineTaskHandler } from '#nuxt-task'

export default defineTaskHandler({
    meta: {
        name: 'example',
        description: 'Example task for testing',
    },
    options: {
        timezone: 'Australia/Sydney',
    },
    schedule: '14 23 * * *',
    handler: async (ctx) => {
        console.log('Example task executed', ctx)

        return {
            message: 909178309,
        }
    }
})
