import { getRunState, snapshotRun } from "./state";
import type { TaskInfo, TaskRun } from "./types";

/**
 * Every registered task, from the metadata nuxt-task reads statically at
 * build time. Empty until nuxt-task's server plugin has run.
 *
 * @returns {TaskInfo[]} Copies of the registry entries
 */
export function listTasks(): TaskInfo[] {
    return (getRunState().registry ?? []).map((task) => ({
        ...task,
        options: { ...task.options },
    }));
}

/**
 * The open run in the current async context: any code called from a task
 * handler, however deep, sees its run. Undefined outside a run, and where
 * AsyncLocalStorage is unavailable.
 *
 * The returned object is live: `status` and `attempt` stay current, and
 * `meta` is writable, so data put there reaches `task:run:finish`.
 *
 * @returns {TaskRun | undefined} The current run
 */
export function getCurrentTaskRun(): TaskRun | undefined {
    return getRunState().runStore?.getStore()?.view;
}

/**
 * Open runs in this process, oldest first.
 *
 * @returns {TaskRun[]} Snapshots of the open runs
 */
export function getRunningTasks(): TaskRun[] {
    return [...getRunState().openRuns.values()].map(snapshotRun);
}

/**
 * Whether the task has an open run, or a triggerTask() call about to start
 * one, in this process.
 *
 * @param {string} name - Task path name
 * @returns {boolean} True while running
 */
export function isTaskRunning(name: string): boolean {
    const state = getRunState();

    if (state.reservations.has(name)) return true;

    for (const record of state.openRuns.values()) {
        if (record.name === name) return true;
    }

    return false;
}
