import { defineVitestConfig } from '@nuxt/test-utils/config'
import { fileURLToPath } from 'node:url'

export default defineVitestConfig({
    test: {
        globals: true,
        environment: 'node',
        include: [
            "test/**/*.test.ts",
            // 'src/**/*.{test,spec}.{ts}',
            // '**/__tests__/**/*.{ts}'
        ],
        coverage: {
            enabled: true,
            provider: 'v8',
            reporter: ['text', 'json', 'html'],
            include: ['src/**/*'],
            exclude: ['**/index.d.ts'],
        },
        exclude: ['node_modules/**/*', 'playground/**/*'],
    },
    resolve: {
        alias: {
            '#tasks': fileURLToPath(new URL('./test/mocks/tasks.ts', import.meta.url)),
        },
    },
})