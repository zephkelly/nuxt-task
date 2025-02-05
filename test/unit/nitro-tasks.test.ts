import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { setup, $fetch } from '@nuxt/test-utils/e2e'



describe('Nitro Experimental Tasks support', async () => {
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