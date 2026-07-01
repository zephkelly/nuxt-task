import { defineTaskHandler } from '#nuxt-task'
// Aliased import (`~` -> app root). Previously broke the custom-mode bundler.
import { getPg } from '~/server/utils/db'
// Relative import into a non-auto-import directory.
import { sendNotification } from '../services/notification'

export default defineTaskHandler({
    meta: {
        name: 'example',
        description: 'Example task using aliased, relative, and auto imports',
    },
    options: {
        timezone: 'Australia/Sydney',
    },
    schedule: '* * * * *',
    handler: async (ctx) => {
        const rows = await getPg().query('select 1')
        const result = sendNotification('example task executed')
        // logTaskRun is auto-imported from server/utils/log (no import above).
        logTaskRun('example')

        console.log('Example task executed', ctx)

        return {
            rows: rows.length,
            sent: result.sent,
        }
    },
})
