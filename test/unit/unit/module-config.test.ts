import { describe, it, expect, beforeEach } from 'vitest'

import {
    ModuleConfiguration,
    DEFAULT_MODULE_OPTIONS,
    RUNTIME_CONFIG_KEY,
    resolveModuleOptions,
    moduleConfiguration,
} from '../../../src/runtime/config'
import type { ModuleOptions } from '../../../src/module'

/**
 * The module publishes its options into the Nitro runtime config under one
 * key, and the runtime reads them back out under another. They disagreed:
 * the module wrote `nuxtTask`, while the plugin and this class both read
 * `cron`. The key never existed, so the custom scheduler silently ran on
 * defaults no matter what the consumer configured.
 *
 * The key now lives in one place, so the two halves cannot drift again.
 */

const customOptions: ModuleOptions = {
    serverTasks: true,
    clientTasks: false,
    experimental: { tasks: false },
    storage: { type: 'memory' },
    timezone: { type: 'Asia/Tokyo', validate: true, strict: true },
}

describe('module configuration resolution', () => {
    let config: ModuleConfiguration

    beforeEach(() => {
        config = new ModuleConfiguration(DEFAULT_MODULE_OPTIONS)
        // resolveModuleOptions reads the shared singleton, which carries state
        // between tests.
        moduleConfiguration.setModuleOptions(DEFAULT_MODULE_OPTIONS)
    })

    it('publishes and reads under the same runtime config key', () => {
        expect(RUNTIME_CONFIG_KEY).toBe('nuxtTask')
    })

    describe('getModuleOptions', () => {
        it('reads options from the runtime config', () => {
            const resolved = config.getModuleOptions({
                [RUNTIME_CONFIG_KEY]: customOptions,
            } as any)

            expect(resolved.timezone.type).toBe('Asia/Tokyo')
        })

        it('returns stored options when called with no runtime config', () => {
            config.setModuleOptions(customOptions)

            expect(config.getModuleOptions().timezone.type).toBe('Asia/Tokyo')
        })

        it('keeps stored options when the runtime config lacks the key', () => {
            config.setModuleOptions(customOptions)

            const resolved = config.getModuleOptions({} as any)

            // Must not clobber good options with undefined.
            expect(resolved).toBeDefined()
            expect(resolved.timezone.type).toBe('Asia/Tokyo')
        })

        it('never returns undefined for an empty runtime config', () => {
            const resolved = config.getModuleOptions({} as any)

            expect(resolved).toEqual(DEFAULT_MODULE_OPTIONS)
        })
    })

    describe('resolveModuleOptions', () => {
        it('prefers options carried on the runtime config', () => {
            expect(resolveModuleOptions({
                [RUNTIME_CONFIG_KEY]: customOptions,
            }).timezone.type).toBe('Asia/Tokyo')
        })

        it('falls back to the singleton when the key is absent', () => {
            expect(resolveModuleOptions({})).toBeDefined()
            expect(resolveModuleOptions({}).timezone).toBeDefined()
        })

        it('falls back when handed no runtime config at all', () => {
            expect(resolveModuleOptions(undefined)).toBeDefined()
        })

        it('ignores a legacy cron key', () => {
            // The old, never-populated key must not quietly start working.
            const resolved = resolveModuleOptions({ cron: customOptions })

            expect(resolved.timezone.type).not.toBe('Asia/Tokyo')
        })
    })
})
