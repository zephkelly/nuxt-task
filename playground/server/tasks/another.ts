import { defineTaskHandler } from './../../../src/runtime/server/nitro/handler'


export default defineTaskHandler({
    meta: {
        name: 'example',
        description: 'Example task for testing',
    },
    schedule: '* * * * *',
    handler: async (ctx) => {
        return {
            message: 'Example task executed'
        }
    }
})