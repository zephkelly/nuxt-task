import { getRunState, type RunRecord } from "./state";
import type { TaskRunHooks } from "./types";

type HookName = keyof TaskRunHooks;

function logHookError(hookName: string, runId: string, error: unknown) {
    console.error(
        `[ nuxt-task ] A "${hookName}" hook failed for run ${runId}. `
        + "The task is unaffected:",
        error
    );
}

/**
 * Calls every listener in turn, each in its own try/catch. hookable's own
 * serial caller stops at the first listener that throws, which would let one
 * broken listener silence the rest.
 */
async function callListeners(
    hooks: any,
    hookName: HookName,
    runId: string,
    event: unknown
): Promise<void> {
    try {
        if (typeof hooks.callHookWith === "function") {
            await hooks.callHookWith(
                async (listeners: Array<(...args: any[]) => any>, args: any[]) => {
                    for (const listener of listeners) {
                        try {
                            await listener(...args);
                        } catch (error) {
                            logHookError(hookName, runId, error);
                        }
                    }
                },
                hookName,
                event
            );
            return;
        }

        await hooks.callHook(hookName, event);
    } catch (error) {
        logHookError(hookName, runId, error);
    }
}

/**
 * Emits a run hook without ever blocking or failing the run.
 *
 * Calls are chained per run, so a run's `finish` listeners start only after
 * its `start` listeners settle (an insert cannot race its update), but the
 * task itself never waits on the chain. Listeners run outside the run's
 * context, so a logger that tags lines through getCurrentTaskRun() does not
 * copy a listener's own logging into the run.
 *
 * @param {RunRecord} record - The run the event belongs to
 * @param {HookName} hookName - The hook to call
 * @param {unknown} event - The hook payload
 */
export function emitRunHook<N extends HookName>(
    record: RunRecord,
    hookName: N,
    event: Parameters<TaskRunHooks[N]>[0]
): void {
    const state = getRunState();
    const hooks = state.nitroApp?.hooks;

    if (!hooks) return;

    const call = () => callListeners(hooks, hookName, record.runId, event);
    const pending = record.hookChain.then(() =>
        state.runStore ? state.runStore.run(undefined, call) : call()
    );

    record.hookChain = pending;
    state.pendingHooks.add(pending);
    pending.then(() => state.pendingHooks.delete(pending));
}

/**
 * Resolves once every hook call emitted so far has settled, or after
 * `timeoutMs`. nuxt-task calls it on Nitro's `close` hook so a graceful
 * shutdown does not drop the last finish events; tests use it too.
 *
 * @param {number} [timeoutMs] - Upper bound on the wait
 * @returns {Promise<void>}
 */
export async function flushTaskRunHooks(timeoutMs = 5000): Promise<void> {
    const state = getRunState();
    let timer: ReturnType<typeof setTimeout> | undefined;

    const deadline = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
    });

    try {
        // Loop: a listener may itself trigger a run whose hooks join the set.
        while (state.pendingHooks.size > 0) {
            const settled = await Promise.race([
                Promise.all([...state.pendingHooks]).then(() => true),
                deadline.then(() => false),
            ]);

            if (!settled) return;
        }
    } finally {
        if (timer) clearTimeout(timer);
    }
}
