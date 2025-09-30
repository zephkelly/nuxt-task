import { defineVitestConfig } from '@nuxt/test-utils/config'

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
})
