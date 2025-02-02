import { defineTask } from 'nitropack/runtime'
// import type { TaskEvent } from 'nitropack'

export default defineTask({
    meta: {
      name: 'example',
      description: 'Example task for testing',
    },
    async run(event: any) {
        return {
            result: {
                success: true,
                message: 'Example task executed'
            }
        }
    }
})