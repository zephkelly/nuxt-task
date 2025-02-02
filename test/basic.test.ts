import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { setup, $fetch } from '@nuxt/test-utils/e2e'



describe('ssr', async () => {
    await setup({
        rootDir: fileURLToPath(new URL('./fixtures/basic', import.meta.url)),
    })

    it('renders the index page', async () => {
        const html = await $fetch('/')
        expect(html).toContain('<div>basic</div>')
    })

    it('should have a working API endpoint', async () => {
        const response = await $fetch('/api/test')

        console.log(response)
        
        expect(response).toEqual({
            status: 200,
            message: 'API is working'
        })
    })
})