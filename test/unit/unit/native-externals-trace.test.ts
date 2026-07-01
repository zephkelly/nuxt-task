import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { setupExperimentalTasks } from '../../../src/module'

// vitest hoists vi.mock above the imports above.

// configureNitroTasks (called by the nitro:config hook) scans the tasks dir and
// reads the fs. For these tests we only care about the externals.trace gating,
// which happens *before* task discovery, so we stub both to a clean no-op:
// scanTasksDirectory yields no tasks, and access() succeeds so we don't bail
// out early with a "no tasks directory" warning.
vi.mock('../../../src/runtime/utils/scanTasks', () => ({
    scanTasksDirectory: vi.fn(async () => []),
}))

vi.mock('node:fs/promises', async (importOriginal) => {
    const actual: any = await importOriginal()
    return { ...actual, access: vi.fn().mockResolvedValue(undefined) }
})

type CapturedHook = (nitroConfig: any) => Promise<void> | void

/**
 * Build a minimal `nuxt` double that captures the `nitro:config` hook so a test
 * can invoke it with a fresh `nitroConfig` and inspect the result.
 */
function makeNuxt(dev: boolean) {
    let nitroConfigHook: CapturedHook | undefined
    const nuxt = {
        options: {
            dev,
            buildDir: '/build',
            serverDir: '/srv',
        },
        hook: vi.fn((name: string, cb: CapturedHook) => {
            if (name === 'nitro:config') nitroConfigHook = cb
        }),
    }
    return {
        nuxt,
        async runNitroConfig(nitroConfig: any) {
            if (!nitroConfigHook) {
                throw new Error('nitro:config hook was not registered')
            }
            await nitroConfigHook(nitroConfig)
            return nitroConfig
        },
    }
}

const resolver = { resolve: (p: string) => p }
const moduleOptions: any = { experimental: { tasks: true } }

/**
 * Regression tests for the ~10x `nuxt dev` startup slowdown in native
 * (experimental) task mode.
 *
 * Root cause: setupExperimentalTasks used to set `nitroConfig.externals.trace =
 * true` unconditionally. Nitro's dev preset deliberately sets it to `false`
 * (dev emits no traced .output), so forcing it true re-enabled @vercel/nft
 * dependency tracing on every dev start — very slow with heavy task imports.
 * The fix only forces tracing for production builds.
 */
describe('native mode: externals.trace dev gating (regression)', () => {
    let logSpy: any
    let warnSpy: any

    beforeEach(() => {
        vi.clearAllMocks()
        logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
        warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    })

    afterEach(() => {
        logSpy.mockRestore()
        warnSpy.mockRestore()
    })

    it('registers a nitro:config hook', async () => {
        const { nuxt } = makeNuxt(false)

        await setupExperimentalTasks(moduleOptions, nuxt as any, resolver)

        expect(nuxt.hook).toHaveBeenCalledWith(
            'nitro:config',
            expect.any(Function),
        )
    })

    it('forces externals.trace = true for production builds', async () => {
        const { nuxt, runNitroConfig } = makeNuxt(false)

        await setupExperimentalTasks(moduleOptions, nuxt as any, resolver)
        const cfg = await runNitroConfig({})

        expect(cfg.externals.trace).toBe(true)
    })

    it('does NOT force externals.trace in dev (keeps Nitro dev default)', async () => {
        const { nuxt, runNitroConfig } = makeNuxt(true)

        await setupExperimentalTasks(moduleOptions, nuxt as any, resolver)
        const cfg = await runNitroConfig({})

        // The key regression assertion: dev must not opt into NFT tracing.
        expect(cfg.externals.trace).toBeUndefined()
    })

    it('does NOT override an explicit externals.trace = false in dev', async () => {
        const { nuxt, runNitroConfig } = makeNuxt(true)

        await setupExperimentalTasks(moduleOptions, nuxt as any, resolver)
        // Mimic Nitro's dev preset, which sets externals.trace = false on purpose.
        const cfg = await runNitroConfig({ externals: { trace: false } })

        expect(cfg.externals.trace).toBe(false)
    })

    it('preserves an existing externals config while enabling trace in prod', async () => {
        const { nuxt, runNitroConfig } = makeNuxt(false)

        await setupExperimentalTasks(moduleOptions, nuxt as any, resolver)
        const cfg = await runNitroConfig({ externals: { external: ['some-dep'] } })

        expect(cfg.externals.external).toEqual(['some-dep'])
        expect(cfg.externals.trace).toBe(true)
    })
})
