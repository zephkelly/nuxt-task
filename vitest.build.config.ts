import { defineConfig } from 'vitest/config'

// Built-app checks: pack the module, install it into a fixture's
// node_modules, `nuxi build` it and run .output/server/index.mjs. Slow, so
// kept out of `npm test`; run with `npm run test:build`.
export default defineConfig({
    test: {
        environment: 'node',
        include: ['test/build/**/*.build.ts'],
        testTimeout: 60_000,
        hookTimeout: 300_000,
        coverage: { enabled: false },
    },
})
