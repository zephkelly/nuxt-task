import { defineNitroPlugin } from "nitropack/dist/runtime/plugin";
// The same module Nitro's schedule runner uses, so runs started here share
// Nitro's in-flight map. Deep path to match the plugin import above.
import { runTask } from "nitropack/dist/runtime/task";

import { attachTaskRuntime } from "../runs/state";
import { flushTaskRunHooks } from "../runs/hooks";
import type { TriggerAdapter } from "../runs/state";
import type { TaskInfo } from "../runs/types";

/**
 * Load the build-time task registry. Empty when it cannot be read.
 */
export async function loadTaskRegistry(): Promise<TaskInfo[]> {
    try {
        // @ts-ignore - virtual file
        const mod = await import("#nuxt-task/registry");
        return Array.isArray(mod.taskRegistry) ? mod.taskRegistry : [];
    } catch {
        return [];
    }
}

/**
 * Connects the run API to Nitro in native mode. triggerTask() starts runs
 * through Nitro's own `runTask`, so Nitro still owns task resolution, and
 * the run's identity travels in async context rather than in the payload.
 *
 * @param {any} nitroApp - The Nitro app
 * @param {Function} nitroRunTask - Nitro's runTask
 */
export async function initializeNativeRuntime(
    nitroApp: any,
    nitroRunTask: (name: string, input: any) => Promise<unknown>
): Promise<void> {
    const adapter: TriggerAdapter = (name, { payload, context }) =>
        nitroRunTask(name, { payload, context });

    // Mode first and synchronously: defineTaskHandler reads it to pick the
    // native branch, and nothing may load a task module ahead of it.
    attachTaskRuntime({ nitroApp, mode: "native", adapter });
    attachTaskRuntime({ registry: await loadTaskRegistry() });

    nitroApp.hooks.hook("close", async () => {
        await flushTaskRunHooks();
    });
}

export default defineNitroPlugin(async (nitroApp) => {
    try {
        await initializeNativeRuntime(nitroApp, runTask);
    } catch (error) {
        console.error("[ nuxt-task ] Failed to initialise run tracking:", error);
    }
});
