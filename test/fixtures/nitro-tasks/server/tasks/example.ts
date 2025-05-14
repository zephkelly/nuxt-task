import { defineTaskHandler } from '../../../../../src/runtime/server/task/handler'



export default defineTaskHandler({
    meta: {
        name: 'example',
        description: 'Example cron task for testing'
    },
    schedule: '*/5 * * * *',
    options: {
        timezone: 'UTC',
        maxRetries: 3,
        retryDelay: 1000,
    },
    async handler({ payload }) {
        return { success: true }
    }
})