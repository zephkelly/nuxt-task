import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { describe, it, expect, beforeAll } from 'vitest'
import { setup, $fetch } from '@nuxt/test-utils/e2e'


describe('ssr', async () => {
    await setup({
        rootDir: fileURLToPath(new URL('./fixtures/basic', import.meta.url)),
        server: true,
        runner: 'vitest',
        setupTimeout: 10000,
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