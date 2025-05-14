import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { setup, createPage, $fetch } from '@nuxt/test-utils/e2e'


describe('basic', async () => {
    beforeAll(() => {
        vi.stubEnv('NODE_ENV', 'test')

        console.log(process.env.NODE_ENV)

        vi.mock('#tasks', () => ({
            taskDefinitions: [
                {
                    meta: {
                        name: 'test-task',
                        description: 'Test task'
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
        rootDir: fileURLToPath(new URL('./fixtures/basic', import.meta.url)),
        server: true,
        browser: true,
        setupTimeout: 60000,
    })
    
    it('renders the index page', async () => {
        const html = await $fetch('/')
        expect(html).toContain('<div>basic</div>')
    })

    it('should have a working API endpoint', async () => {
        const response = await $fetch('/api/test')
        expect(response).toEqual({
            status: 200,
            message: 'API is working'
        })
    })
})