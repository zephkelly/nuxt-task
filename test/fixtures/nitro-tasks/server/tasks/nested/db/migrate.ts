import { defineTaskHandler } from '../../../../../../../src/runtime/server/task/handler'



export default defineTaskHandler({
    meta: {
        name: 'migrate',
        description: 'Database migration task'
    },
    schedule: '0 0 * * *',
    options: {
        timezone: 'UTC',
        exclusive: true,
    },
    async handler({ payload }) {
        return { migrated: true, timestamp: Date.now() }
    }
})