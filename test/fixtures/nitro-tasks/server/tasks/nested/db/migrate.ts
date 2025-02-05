import { defineTaskHandler } from '../../../../../../../src/runtime/server/nitro/handler'



export default defineTaskHandler({
    meta: {
        name: 'migrate',
        description: 'Database migration task'
    },
    schedule: '0 0 * * *', // Daily at midnight
    options: {
        timezone: 'UTC',
        exclusive: true,
    },
    async handler({ payload }) {
        return { migrated: true, timestamp: Date.now() }
    }
})