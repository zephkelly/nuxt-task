import { defineTaskHandler } from '#nuxt-task'

export default defineTaskHandler({
        meta: {
                name: 'another',
                description: 'Example task for testing',
        },
        schedule: '* * 1 * *',
        handler: async (ctx) => {
                return {
                        message: 'Example task executed',
    }
        }
})
