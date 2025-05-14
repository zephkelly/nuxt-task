import { fileURLToPath } from 'node:url'
import { describe, it, expect, beforeAll, vi } from 'vitest'
import { setup, $fetch } from '@nuxt/test-utils/e2e'



describe('Nitro Experimental Tasks support', async () => {
    beforeAll(() => {
        vi.mock('#tasks', () => ({
            taskDefinitions: [
                {
                    meta: {
                        name: 'test-nitro-task',
                        description: 'Test Nitro task'
                    },
                    schedule: '* * * * *',
                    run: vi.fn().mockResolvedValue(undefined),
                    _custom: {
                        type: 'cron-task',
                        version: '1.0',
                        virtual: true
                    }
                }
            ]
        }))
    })

    await setup({
        rootDir: fileURLToPath(new URL('./../fixtures/nitro-tasks', import.meta.url)),
        server: true,
        browser: false,
        runner: 'vitest',
    })

    it('should setup server side nitro tasks properly and have a working API endpoint', async () => {
        const response = await $fetch('/api/test')
        expect(response).toEqual({
            status: 200,
            message: 'API is working'
        })
    })
})