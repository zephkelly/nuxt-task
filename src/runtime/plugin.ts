import { defineNitroPlugin } from 'nitropack/dist/runtime/plugin'
import { createServerStorage } from './storage/server'
import { Scheduler } from './scheduler'
import { moduleConfiguration } from './config'

import { useRuntimeConfig } from '#imports'

export default defineNitroPlugin(async (nitroApp) => {
        const config = useRuntimeConfig()
  const moduleOptions = config.cron || moduleConfiguration.getModuleOptions()
  if (moduleOptions.experimental?.tasks) {
                console.warn(
                        "Experimental tasks are enabled, using Nitro's native task scheduler."
                );
                return;
        }

        if (import.meta.test) {
                console.log('Skipping scheduler in test environment')
    return;
        }

        try {
                const storage = await createServerStorage({ type: 'memory' })
    const scheduler = new Scheduler(storage, moduleOptions, {
                        tickInterval: 1000,
                        maxConcurrent: 10,
                        handleMissedTasks: true,
                })

    let taskDefinitions = []
    try {
                        // @ts-ignore - we are using a virtual file
                        const tasksVirtualFile = await import('#tasks')
      taskDefinitions = tasksVirtualFile.taskDefinitions || []
    }
                catch {
                        console.warn('No tasks found, skipping scheduler.')
      return;
                }

                for (const task of taskDefinitions) {
                        await scheduler.addTask({
                                name: task.meta.name,
                                options: { expression: task.schedule, ...task.options },
                                execute: task.run,
                        })
    }

                await scheduler.start()

    nitroApp.hooks.hook('close', async () => {
                        await scheduler.stop()
    })

    // @ts-ignore - Dont know how to type the NitroApp
    nitroApp.scheduler = scheduler
  }
        catch (error) {
                console.error('Failed to initialize cron scheduler:', error)
  }
})
