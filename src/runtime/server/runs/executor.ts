import {
    createRunId,
    createRunView,
    getRunState,
    snapshotRun,
    type Reservation,
    type RunOutcome,
    type RunRecord,
    type RunState,
} from "./state";
import { emitRunHook } from "./hooks";
import { cronerPreviousRun } from "./schedule";
import { TaskTimeoutError } from "./errors";
import type { TaskRunStatus, TaskTrigger } from "./types";

export interface RunExecutionOptions {
    timeout?: number;
    maxRetries?: number | null;
    retryDelay?: number;
}

export interface ExecuteTaskRunInput<T> {
    /** Path name. */
    name: string;
    metaName: string | undefined;
    /** The definition's own schedule, used when the registry has no entry. */
    schedule: string | undefined;
    /**
     * Set only by the custom scheduler, which knows the tick it is running.
     * Its presence marks the run as scheduled.
     */
    scheduled?: { scheduledFor: Date | null };
    options: RunExecutionOptions;
    /** Runs once before the first attempt; a throw fails the run, no retry. */
    preflight?: () => void;
    /** Calls the handler for one attempt. */
    invoke: () => Promise<T> | T;
}

/**
 * Attempts allowed for one run: the initial attempt plus retries. An unset
 * `maxRetries` means one attempt, and `maxRetries: 0` means "do not retry",
 * never "do not run".
 *
 * @param {number | undefined | null} maxRetries - Configured retry count
 * @returns {number} Attempts allowed, at least one
 */
export function resolveMaxAttempts(maxRetries?: number | null): number {
    if (maxRetries === undefined || maxRetries === null) {
        return 1;
    }

    return Math.max(0, maxRetries) + 1;
}

/**
 * Races an attempt against its timeout, only when one is configured.
 *
 * Racing against an already-resolved promise would resolve every untimed
 * task instantly, before its handler had finished.
 *
 * @param {Promise<T>} execution - The in-flight attempt
 * @param {number | undefined} timeout - Timeout in milliseconds
 * @returns {Promise<T>} The attempt's result
 */
async function withTimeout<T>(
    execution: Promise<T>,
    timeout?: number
): Promise<T> {
    if (!timeout) {
        return await execution;
    }

    let timer: ReturnType<typeof setTimeout> | undefined;

    try {
        return await Promise.race([
            execution,
            new Promise<never>((_, reject) => {
                timer = setTimeout(
                    () => reject(new TaskTimeoutError()),
                    timeout
                );
            }),
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

function isSkipped(result: unknown): boolean {
    return (
        typeof result === "object"
        && result !== null
        && (result as { skipped?: unknown }).skipped === true
    );
}

interface ResolvedTrigger {
    trigger: TaskTrigger;
    runId: string;
    triggeredBy: string | undefined;
    scheduledFor: Date | null;
    reservation: Reservation | undefined;
}

/**
 * Decides how a run was started from the call path alone. Payload contents
 * play no part, so no payload key can make a run look manual or scheduled.
 */
function resolveTrigger(
    input: ExecuteTaskRunInput<unknown>,
    state: RunState
): ResolvedTrigger {
    // 1. Started by triggerTask(): its reservation travels in async context.
    //    Without AsyncLocalStorage, fall back to the reservation map, which
    //    only triggerTask() writes.
    const reservation = state.triggerStore
        ? state.triggerStore.getStore()
        : state.reservations.get(input.name);

    if (
        reservation
        && reservation.name === input.name
        && !reservation.claimed
    ) {
        return {
            trigger: "manual",
            runId: reservation.runId,
            triggeredBy: reservation.triggeredBy,
            scheduledFor: null,
            reservation,
        };
    }

    const base = {
        runId: createRunId(),
        triggeredBy: undefined,
        reservation: undefined,
    };

    // 2. Started from inside another run's handler: code started it.
    if (state.runStore?.getStore()) {
        return { ...base, trigger: "manual", scheduledFor: null };
    }

    // 3. The custom scheduler says which tick this is.
    if (input.scheduled) {
        return {
            ...base,
            trigger: "schedule",
            scheduledFor: input.scheduled.scheduledFor,
        };
    }

    // 4. Native mode, or an unattributed call. A task with no schedule
    //    cannot have been fired by a scheduler.
    const registered = state.registry?.find((t) => t.name === input.name);
    const schedule = registered ? registered.schedule : input.schedule;

    if (!schedule) {
        return { ...base, trigger: "manual", scheduledFor: null };
    }

    // Nitro's payload carries the boot time, so compute the tick instead:
    // the latest occurrence at or before now, in the zone croner fires in.
    let scheduledFor: Date | null = null;

    try {
        scheduledFor = cronerPreviousRun(schedule, new Date());
    } catch {
        scheduledFor = null;
    }

    return { ...base, trigger: "schedule", scheduledFor };
}

function invokeInContext<T>(
    state: RunState,
    record: RunRecord,
    invoke: () => Promise<T> | T
): Promise<T> {
    const call = async () => await invoke();

    // The handler runs inside this run's context and outside any trigger
    // context, so a nested triggerTask()/runTask() cannot claim this run's
    // reservation.
    const inRun = state.runStore
        ? () => state.runStore!.run(record, call)
        : call;

    return state.triggerStore
        ? state.triggerStore.run(undefined, inRun)
        : inRun();
}

/**
 * Runs one task run: opens it, calls the handler with retries and timeout,
 * closes it with a status, emits hooks, and rethrows a failure.
 *
 * Every run in both modes goes through here. Bookkeeping is synchronous and
 * in memory, and the run is registered before the first await, so it is
 * visible to getRunningTasks() by the time Nitro records it as running.
 *
 * @param {ExecuteTaskRunInput<T>} input - The run to execute
 * @returns {Promise<T>} The handler's raw result
 */
export async function executeTaskRun<T>(
    input: ExecuteTaskRunInput<T>
): Promise<T> {
    const state = getRunState();
    const resolved = resolveTrigger(input, state);

    let settle!: (outcome: RunOutcome) => void;
    const record = {
        runId: resolved.runId,
        name: input.name,
        metaName: input.metaName,
        trigger: resolved.trigger,
        triggeredBy: resolved.triggeredBy,
        scheduledFor: resolved.scheduledFor,
        startedAt: new Date(),
        finishedAt: null,
        attempt: 1,
        maxAttempts: resolveMaxAttempts(input.options.maxRetries),
        status: "running",
        meta: {},
        done: new Promise<RunOutcome>((resolve) => {
            settle = resolve;
        }),
        hookChain: Promise.resolve(),
    } as unknown as RunRecord;
    record.view = createRunView(record);

    state.openRuns.set(record.runId, record);

    if (resolved.reservation) {
        resolved.reservation.claimed = true;
        resolved.reservation.record = record;
        resolved.reservation.markStarted(record);
    }

    emitRunHook(record, "task:run:start", { run: snapshotRun(record) });

    let result: T | undefined;
    let lastError: unknown;
    let status: Exclude<TaskRunStatus, "running"> | undefined;

    try {
        input.preflight?.();

        for (let attempt = 1; ; attempt++) {
            record.attempt = attempt;

            try {
                result = await withTimeout(
                    invokeInContext(state, record, input.invoke),
                    input.options.timeout
                );
                status = isSkipped(result) ? "skipped" : "succeeded";
                break;
            } catch (error) {
                lastError = error;

                if (attempt >= record.maxAttempts) break;

                const retryInMs = input.options.retryDelay ?? 1000;

                emitRunHook(record, "task:run:attempt-failed", {
                    run: snapshotRun(record),
                    attempt,
                    error,
                    retryInMs,
                });

                await new Promise((resolve) => setTimeout(resolve, retryInMs));
            }
        }
    } catch (error) {
        // preflight threw
        lastError = error;
    }

    const failed = status === undefined;
    const finalStatus: Exclude<TaskRunStatus, "running"> = status
        ?? (lastError instanceof TaskTimeoutError ? "timed-out" : "failed");

    // Rethrown exactly as before: an Error as is, anything else wrapped.
    const thrown = failed
        ? lastError instanceof Error
            ? lastError
            : new Error("Unknown error in task execution")
        : undefined;

    record.status = finalStatus;
    record.finishedAt = new Date();
    state.openRuns.delete(record.runId);

    emitRunHook(record, "task:run:finish", {
        run: snapshotRun(record),
        status: finalStatus,
        result: failed ? undefined : result,
        error: thrown,
        durationMs: record.finishedAt.getTime() - record.startedAt.getTime(),
    });

    if (failed) {
        console.error(
            `[ nuxt-task ] Task "${record.name}" failed:`,
            lastError
        );
        settle({ ok: false, error: thrown });
        throw thrown;
    }

    settle({ ok: true, result });
    return result as T;
}
