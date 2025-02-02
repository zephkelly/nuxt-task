import nuxtCron, { type ModuleOptions } from '../../../src/module'



const cronConfig: ModuleOptions = {
    experimental: {
      tasks: true
    },
    serverTasks: true,
    storage: {
      type: 'memory'
    },
    timezone: {
      type: 'UTC',
      validate: true,
      strict: false
    }
}

export default defineNuxtConfig({
    rootDir: __dirname,
    modules: [
        nuxtCron,
    ],
    cron: cronConfig,
    nitro: {
        experimental: {
            tasks: true
        },
        scheduledTasks: {
            '* * * * *': ['nitroexample']
        }
    },
    typescript: {
        typeCheck: true,
        tsConfig: {
            extends: '../../../tsconfig.json'
        }
    }
})
