import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setup } from '@nuxt/test-utils'

import { createResolver } from '@nuxt/kit'
import { useNuxtApp } from '#app'

import { ModuleConfigurationManager, setModuleOptions, getModuleOptions } from '../../src/runtime/config'
import { configureNitroTasks, type ModuleOptions } from '../../src/module'

const moduleConfig = ModuleConfigurationManager.getInstance()

// @vitest-environment nuxt
describe('Module Configuration - Experimental Tasks', async () => {
  await setup({
    rootDir: './test/fixtures/config-test',
    server: false,
    browser: false,
    runner: 'vitest',
    setupTimeout: 10000,

    nuxtConfig: {
        nitro: {
            experimental: {
                tasks: true
            }
        }
    }
  })

  beforeEach(() => {
    moduleConfig.resetModuleOptions()
    vi.clearAllMocks()
  })

  describe('ModuleConfigurationManager', () => {
    it('should not enable experimental tasks when set to false', () => {
      const options: ModuleOptions = {
        serverTasks: true,
        experimental: {
          tasks: false
        },
        timezone: {
          type: 'UTC',
          validate: true,
          strict: false
        }
      }

      setModuleOptions(options)

      const currentOptions = getModuleOptions()
      expect(currentOptions.experimental?.tasks).toBe(false)
    })

    it('should enable experimental tasks when set to true', () => {
      const options: ModuleOptions = {
        serverTasks: true,
        experimental: {
          tasks: true
        },
        timezone: {
          type: 'UTC',
          validate: true,
          strict: false
        }
      }

      setModuleOptions(options)

      const currentOptions = getModuleOptions()
      expect(currentOptions.experimental?.tasks).toBe(true)
    })

    it('should maintain default experimental tasks setting when not specified', () => {
      const options: ModuleOptions = {
        serverTasks: true,
        timezone: {
          type: 'UTC',
          validate: true,
          strict: false
        }
      }

      setModuleOptions(options)

      const currentOptions = getModuleOptions()
      expect(currentOptions.experimental?.tasks).toBe(false)
    })


    it('should maintain default experimental tasks setting when not specified, and then update at runtime', () => {
        const options: ModuleOptions = {
          serverTasks: true,
          timezone: {
            type: 'UTC',
            validate: true,
            strict: false
          }
        }
  
        setModuleOptions(options)

        const currentOptions = getModuleOptions()
        expect(currentOptions.experimental?.tasks).toBe(false)


        const optionsUpdated: ModuleOptions = {
            serverTasks: true,
            timezone: {
              type: 'UTC',
              validate: true,
              strict: false
            },
            experimental: {
                tasks: true
            }
        }

        setModuleOptions(optionsUpdated)

        const updatedOptions = getModuleOptions()
        expect(updatedOptions.experimental?.tasks).toBe(true)
    })
  })

  describe('Nuxt Module Setup', () => {
    it('should not configure nitro tasks when experimental.tasks is false', async () => {
      const mockNitroConfig: {
        tasks?: Record<string, any>;
        scheduledTasks?: any[];
        handlers?: Record<string, any>;
      } = {}

      const { resolve } = createResolver(import.meta.url)
      const testDir = resolve('.')
      
      const mockNuxt = {
        options: {
          serverDir: testDir,
          build: {},
          runtimeConfig: {
            public: {}
          }
        }
      }

      const defaultOptions: ModuleOptions = {
        serverTasks: true,
        experimental: {
          tasks: false
        },
        timezone: {
          type: 'UTC',
          validate: true,
          strict: false
        }
      }

      await configureNitroTasks(defaultOptions, mockNitroConfig, mockNuxt)

      expect(mockNitroConfig.tasks).toBeUndefined()
      expect(mockNitroConfig.scheduledTasks).toBeUndefined()
      expect(mockNitroConfig.handlers).toBeUndefined()
    })

    it('should validate that serverTasks is enabled when experimental.tasks is true', () => {
      const options: ModuleOptions = {
        serverTasks: false,
        experimental: {
          tasks: true
        },
        timezone: {
          type: 'UTC',
          validate: true,
          strict: false
        }
      }

      expect(() => setModuleOptions(options)).toThrow('Invalid module options')
      const currentOptions = getModuleOptions()
      expect(currentOptions.experimental?.tasks).toBe(false)
    })
  })
})