import { AsyncLocalStorage } from "node:async_hooks";

import type {
    TaskInfo,
    TaskRun,
    TaskRunStatus,
    TaskTrigger,
} from "./types";

export type RunOutcome =
    | { ok: true; result: unknown }
    | { ok: false; error: unknown };

/** One open or finished run. Internal: apps see `view` or a snapshot. */
export interface RunRecord {
    runId: string;
    name: string;
    metaName: string | undefined;
    trigger: TaskTrigger;
    triggeredBy: string | undefined;
    scheduledFor: Date | null;
    startedAt: Date;
    finishedAt: Date | null;
    attempt: number;
    maxAttempts: number;
    status: TaskRunStatus;
    meta: Record<string, unknown>;
    /** Live, read-only view handed out by getCurrentTaskRun(). */
    view: TaskRun;
    /** Settles when the run ends. Never rejects. */
    done: Promise<RunOutcome>;
    /** This run's hook calls, chained so `finish` follows `start`. */
    hookChain: Promise<void>;
}

/**
 * A `triggerTask()` call that has not reached the handler yet. Holding it in
 * the registry from the first synchronous step closes the gap in which two
 * same-tick calls could both start a run.
 */
export interface Reservation {
    name: string;
    runId: string;
    triggeredBy: string | undefined;
    claimed: boolean;
    record?: RunRecord;
    started: Promise<RunRecord>;
    markStarted: (record: RunRecord) => void;
}

export type TriggerAdapter = (
    name: string,
    input: { payload: Record<string, any>; context: Record<string, any> }
) => Promise<unknown>;

export type ExecutionMode = "native" | "custom";

export interface RunState {
    /** Undefined where AsyncLocalStorage is unavailable (edge runtimes). */
    runStore: AsyncLocalStorage<RunRecord | undefined> | undefined;
    triggerStore: AsyncLocalStorage<Reservation | undefined> | undefined;
    openRuns: Map<string, RunRecord>;
    reservations: Map<string, Reservation>;
    pendingHooks: Set<Promise<void>>;
    nitroApp: { hooks: any } | undefined;
    adapter: TriggerAdapter | undefined;
    mode: ExecutionMode | undefined;
    registry: TaskInfo[] | undefined;
    /** Custom mode: path name for each loaded definition object. */
    definitionNames: WeakMap<object, string>;
    /** Keys of the warnings already printed, so each prints once. */
    warned: Set<string>;
}

// Keyed on globalThis so that `#nuxt-task`, `nuxt-task/handler` and
// `nuxt-task/runtime` share one registry even if a bundler ends up with two
// copies of this module.
const STATE_KEY = Symbol.for("nuxt-task:runs");

function createAsyncStorage<T>(): AsyncLocalStorage<T> | undefined {
    try {
        if (typeof AsyncLocalStorage !== "function") return undefined;
        return new AsyncLocalStorage<T>();
    } catch {
        return undefined;
    }
}

function createState(): RunState {
    return {
        runStore: createAsyncStorage<RunRecord | undefined>(),
        triggerStore: createAsyncStorage<Reservation | undefined>(),
        openRuns: new Map(),
        reservations: new Map(),
        pendingHooks: new Set(),
        nitroApp: undefined,
        adapter: undefined,
        mode: undefined,
        registry: undefined,
        definitionNames: new WeakMap(),
        warned: new Set(),
    };
}

export function getRunState(): RunState {
    const holder = globalThis as unknown as Record<symbol, RunState>;

    if (!holder[STATE_KEY]) {
        holder[STATE_KEY] = createState();
    }

    return holder[STATE_KEY];
}

export interface AttachTaskRuntimeOptions {
    nitroApp?: { hooks: any };
    mode?: ExecutionMode;
    adapter?: TriggerAdapter;
    registry?: TaskInfo[];
}

/**
 * Called by nuxt-task's server plugins to connect the run API to Nitro.
 * Exported for tests and for custom integrations.
 *
 * @param {AttachTaskRuntimeOptions} options - Pieces to attach
 */
export function attachTaskRuntime(options: AttachTaskRuntimeOptions): void {
    const state = getRunState();

    if (options.nitroApp) state.nitroApp = options.nitroApp;
    if (options.mode) state.mode = options.mode;
    if (options.adapter) state.adapter = options.adapter;
    if (options.registry) state.registry = options.registry;
}

/**
 * Prints a warning the first time `key` is seen in this process.
 *
 * @param {string} key - Identifies the warning
 * @param {string} message - What to print
 */
export function warnOnce(key: string, message: string): void {
    const state = getRunState();
    if (state.warned.has(key)) return;
    state.warned.add(key);
    console.warn(message);
}

/** Drops all run state. For tests. */
export function resetTaskRuntime(): void {
    const holder = globalThis as unknown as Record<symbol, RunState>;
    holder[STATE_KEY] = createState();
}

export function createRunId(): string {
    const webCrypto = (globalThis as any).crypto;

    if (webCrypto && typeof webCrypto.randomUUID === "function") {
        return webCrypto.randomUUID();
    }

    // RFC 4122 v4 layout from Math.random, only where Web Crypto is missing.
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
}

/**
 * Copies `meta` deeply, so a hook that persists asynchronously records what
 * it was at the event, not what a later attempt changed it to. Values that
 * cannot be cloned (functions, class instances with private state) fall back
 * to a shallow copy.
 */
function copyMeta(meta: Record<string, unknown>): Record<string, unknown> {
    try {
        return structuredClone(meta);
    } catch {
        return { ...meta };
    }
}

/**
 * A plain copy of a run, safe to hand to hooks and callers. Later mutation
 * of the live run does not rewrite what a hook received.
 *
 * @param {RunRecord} record - The run
 * @returns {TaskRun} A detached copy
 */
export function snapshotRun(record: RunRecord): TaskRun {
    return {
        runId: record.runId,
        name: record.name,
        metaName: record.metaName,
        trigger: record.trigger,
        triggeredBy: record.triggeredBy,
        scheduledFor: record.scheduledFor,
        startedAt: record.startedAt,
        finishedAt: record.finishedAt,
        attempt: record.attempt,
        maxAttempts: record.maxAttempts,
        status: record.status,
        meta: copyMeta(record.meta),
    };
}

const VIEW_FIELDS = [
    "runId",
    "name",
    "metaName",
    "trigger",
    "triggeredBy",
    "scheduledFor",
    "startedAt",
    "finishedAt",
    "attempt",
    "maxAttempts",
    "status",
] as const;

/**
 * A live, read-only view over a record: status and attempt stay current, and
 * `meta` is the record's own object, so writes to it reach the finish hook.
 *
 * @param {RunRecord} record - The run
 * @returns {TaskRun} The view
 */
export function createRunView(record: RunRecord): TaskRun {
    const view = {} as TaskRun;

    for (const field of VIEW_FIELDS) {
        Object.defineProperty(view, field, {
            get: () => record[field],
            enumerable: true,
        });
    }

    Object.defineProperty(view, "meta", {
        get: () => record.meta,
        set: (value: unknown) => {
            record.meta = value && typeof value === "object"
                ? (value as Record<string, unknown>)
                : {};
        },
        enumerable: true,
    });

    return view;
}
