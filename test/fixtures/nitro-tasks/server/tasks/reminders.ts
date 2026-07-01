import { defineTaskHandler } from '../../../../../src/runtime/server/task/handler'
// Aliased import (`~` -> fixture root). This is the case that used to be
// dropped at build time before static metadata extraction.
import { getPg } from '~/server/utils/db'
// Relative import into a non-auto-import directory.
import { buildReminder } from '../services/reminder'

export default defineTaskHandler({
    meta: {
        name: 'reminders',
        description: 'Send reminders (aliased + relative + auto imports)',
    },
    schedule: '30 9 * * *',
    options: {
        timezone: 'UTC',
    },
    async handler() {
        const rows = await getPg().query('select 1')
        const message = buildReminder(rows.length)
        // sendAlert is auto-imported from server/utils/notify (no import above).
        sendAlert(message)
        return { reminders: rows.length, message }
    },
})
