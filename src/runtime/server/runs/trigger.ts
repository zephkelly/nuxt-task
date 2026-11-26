import {
    createRunId,
    getRunState,
    type Reservation,
    type RunOutcome,
    type RunRecord,
    type RunState,
} from "./state";
import {
    TaskAlreadyRunningError,
    TaskNotFoundError,
    TaskRuntimeNotReadyError,
} from "./errors";
import type { TriggerTaskOptions, TriggerTaskResult } from "./types";

interface TriggerReservation extends Reservation {
    /** Settles with the run's outcome once the trigger has finished. */
    outcome: Promise<RunOutcome>;
}

function findOpen(
    state: RunState,
    name: string
): { runId: string; outcome: Promise<RunOutcome> } | undefined {
    const reservation = state.reservations.get(name) as
        | TriggerReservation
        | undefined;

    if (reservation) {
        return { runId: reservation.runId, outcome: reservation.outcome };
    }

    for (const record of state.openRuns.values()) {
        if (record.name === name) {
            return { runId: record.runId, outcome: record.done };
        }
    }

    return undefined;
}

function unwrap(outcome: RunOutcome): unknown {
    if (!outcome.ok) throw outcome.error;
    return outcome.result;
}

/**
 * Starts a task by hand, with `trigger: 'manual'` set from this call path.
 *
 * By default it refuses to start a task that already has an open run in this
 * process and throws `TaskAlreadyRunningError`, rather than letting the
 * caller silently join the open run and lose its payload, which is what
 * Nitro's `runTask` does. Locking across processes is up to the app.
 *
 * @param {string} name - Task path name, e.g. `notifications:daily-reminders`
 * @param {TriggerTaskOptions} [options] - Payload, ids and behaviour
 * @returns {Promise<TriggerTaskResult>} The run id, and the result when waited
 * @throws {TaskAlreadyRunningError} When running and `ifRunning` is `reject`
 * @throws {TaskNotFoundError} When no such task is registered
 */
export async function triggerTask(
    name: string,
    options: TriggerTaskOptions = {}
): Promise<TriggerTaskResult> {
    const state = getRunState();
    const {
        payload = {},
        context = {},
        triggeredBy,
        ifRunning = "reject",
        wait = true,
    } = options;

    if (state.registry && !state.registry.some((t) => t.name === name)) {
        throw new TaskNotFoundError(name);
    }

    const open = findOpen(state, name);

    if (open) {
        if (ifRunning !== "join") {
            throw new TaskAlreadyRunningError(name, open.runId);
        }

        if (!wait) return { runId: open.runId, joined: true };

        return {
            runId: open.runId,
            joined: true,
            result: unwrap(await open.outcome),
        };
    }

    const adapter = state.adapter;
    if (!adapter) throw new TaskRuntimeNotReadyError();

    const runId = options.runId ?? createRunId();
    const runIdTaken = state.openRuns.has(runId)
        || [...state.reservations.values()].some((r) => r.runId === runId);

    if (runIdTaken) {
        throw new Error(`[ nuxt-task ] A run with id "${runId}" is already open.`);
    }

    // Reserve synchronously, before the first await, so a second call in the
    // same tick sees this one.
    let markStarted!: (record: RunRecord) => void;
    const reservation = {
        name,
        runId,
        triggeredBy,
        claimed: false,
        started: new Promise<RunRecord>((resolve) => {
            markStarted = resolve;
        }),
    } as TriggerReservation;
    reservation.markStarted = markStarted;

    state.reservations.set(name, reservation);

    const release = () => {
        if (state.reservations.get(name) === reservation) {
            state.reservations.delete(name);
        }
    };

    // From here the open run in the registry stands for this call.
    reservation.started.then(release);

    let execution: Promise<unknown>;

    try {
        const call = () => adapter(name, { payload, context });
        execution = state.triggerStore
            ? state.triggerStore.run(reservation, call)
            : call();
    } catch (error) {
        release();
        throw error;
    }

    const adapterOutcome: Promise<RunOutcome> = Promise.resolve(execution).then(
        (result) => ({ ok: true as const, result }),
        (error) => ({ ok: false as const, error })
    );

    reservation.outcome = adapterOutcome.then((outcome) => {
        release();

        if (reservation.record) return reservation.record.done;

        // The adapter settled without starting a run for this call.
        if (!outcome.ok) return outcome;

        // Nitro handed back another call's in-flight run. Report it rather
        // than pretend this payload ran.
        return {
            ok: false as const,
            error: new TaskAlreadyRunningError(name),
        };
    });

    if (!wait) {
        const first = await Promise.race([
            reservation.started.then(() => undefined),
            reservation.outcome,
        ]);

        if (first === undefined) {
            // Started. The run continues in the background. `outcome` never
            // rejects, so a later failure surfaces through hooks and the log,
            // never as an unhandled rejection.
            return { runId, joined: false };
        }

        unwrap(first);
        return { runId, joined: false };
    }

    return { runId, joined: false, result: unwrap(await reservation.outcome) };
}
