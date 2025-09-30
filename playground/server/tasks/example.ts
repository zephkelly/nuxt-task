import { defineTaskHandler } from '#nuxt-task'

export default defineTaskHandler({
        meta: {
                name: 'example',
                description: 'Example task for testing',
        },
        schedule: '* * * * *',
        handler: async (ctx) => {
    console.log('Example task executed', ctx)

                return {
                        message: 909178309,
                }
        }
})
