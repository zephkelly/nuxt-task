import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'url';



export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        include: ['test/**/*.test.ts'],
        exclude: ['node_modules/**/*', 'playground/**/*'],
    },
    resolve: {
        alias: {
          '@': fileURLToPath(new URL('./src', import.meta.url)),
        },
    },
})