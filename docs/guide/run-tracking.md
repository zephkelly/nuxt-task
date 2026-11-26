# Run tracking

nuxt-task records every task run, in both execution modes. Your app can list its tasks, show which ones are running, keep a run history, attach log lines to runs, and start a task by hand, without wrapping each task file.

This page explains how it works and what each part of the API guarantees. For a shorter overview, see the README.

::: tip Added in 1.3.0
Existing task files work unchanged. Run tracking needs no configuration and stores nothing itself: your app listens to hooks and keeps what it needs.
:::

## At a glance

```ts
// server/plugins/task-runs.ts
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('task:run:finish', ({ run, status, durationMs }) => {
    console.log(`${run.name} ${status} in ${durationMs}ms (${run.trigger})`)
  })
})
```

```ts
// server/api/tasks/index.get.ts
export default defineEventHandler(() =>
  listTasks().map(task => ({
    ...task,
    running: isTaskRunning(task.name),
    nextRun: nextRun(task.name),
  })),
)
```

The API is auto-imported in server code. You can also import it explicitly:

```ts
import {
  triggerTask,
  getCurrentTaskRun,
  getRunningTasks,
  isTaskRunning,
  listTasks,
  nextRun,
  flushTaskRunHooks,
  TaskAlreadyRunningError,
  TaskNotFoundError,
  TaskTimeoutError,
  TaskRuntimeNotReadyError,
} from 'nuxt-task/runtime'
```

`flushTaskRunHooks`, `TaskTimeoutError` and `TaskRuntimeNotReadyError` are not auto-imported. If the auto-imported names clash with your own, set `nuxtTask.autoImports: false` and import from `nuxt-task/runtime` instead.

## Task names

Everywhere nuxt-task names a task (the registry, runs, hooks, errors and its own logs), it uses the **path name**. That's the name Nitro registers the task under and the one `runTask` takes:

| File | Path name |
|---|---|
| `server/tasks/cleanup.ts` | `cleanup` |
| `server/tasks/notifications/daily-reminders.ts` | `notifications:daily-reminders` |

The free-text `meta.name` from the task file is kept as `metaName`. Use it as a display label, not as an identifier.

## What a run is

A run is one execution of a task. Retries belong to the same run: a task with `maxRetries: 2` that fails twice and then succeeds is one run that took three attempts.

```text
task:run:start
  attempt 1 ── fails ──► task:run:attempt-failed   (wait retryDelay)
  attempt 2 ── fails ──► task:run:attempt-failed   (wait retryDelay)
  attempt 3 ── succeeds
task:run:finish   status: 'succeeded', run.attempt: 3
```

Each run is described by a `TaskRun`:

| Field | Type | Meaning |
|---|---|---|
| `runId` | `string` | A UUID, or the id you passed to `triggerTask`. |
| `name` | `string` | The path name. |
| `metaName` | `string \| undefined` | `meta.name` from the task file. |
| `trigger` | `'schedule' \| 'manual'` | How the run was started. See [How the trigger is decided](#how-the-trigger-is-decided). |
| `triggeredBy` | `string \| undefined` | The string you passed to `triggerTask`. nuxt-task never interprets it. |
| `scheduledFor` | `Date \| null` | The cron tick a scheduled run belongs to. `null` for manual runs. |
| `startedAt` | `Date` | When the run opened. |
| `finishedAt` | `Date \| null` | When it closed. `null` while running. |
| `attempt` | `number` | The current attempt, starting at 1. |
| `maxAttempts` | `number` | `maxRetries + 1`. |
| `status` | see below | The run's state. |
| `meta` | `Record<string, unknown>` | Your own data. The only field you can write to. |

### Status

| Status | When |
|---|---|
| `running` | The run is open. |
| `succeeded` | The handler returned. |
| `skipped` | The handler returned an object with `skipped: true`. |
| `failed` | The last attempt threw. |
| `timed-out` | The last attempt exceeded `options.timeout`. |

Use `skipped` for a run that had nothing to do, such as quiet hours or an empty queue:

```ts
async handler() {
  const pending = await countPendingEmails()
  if (pending === 0) return { skipped: true, reason: 'nothing to send' }
  // ...
}
```

::: warning A timeout does not cancel the handler
When an attempt times out, the run closes as `timed-out` (or moves on to the next attempt), but the handler's own promise keeps running in the background. Make long handlers check for their own cancellation if that matters.
:::

### Results and errors are unchanged

Run tracking does not change what your handler returns or throws:

- `run()` still returns `{ success: true, ...result }`, so existing `runTask` callers keep working. Hooks and `triggerTask` get the handler's **raw** return value.
- Errors are rethrown as before. The same `Error` object reaches the caller and the `task:run:finish` hook, and a thrown non-`Error` value is still wrapped as `Unknown error in task execution`.

## How the trigger is decided

`trigger` is decided by **how the run was started**, never by the payload. No payload key (`trigger`, `runId`, `triggeredBy`, or anything else) can make a run look manual or scheduled, so you can pass user input to `triggerTask` safely.

A run is `manual` when it was:

1. started by `triggerTask`; or
2. started from inside another task's handler (code started it, so a scheduler didn't); or
3. a run of a task that has no schedule (no scheduler could have started it).

Every other run is `schedule`.

::: warning Native mode: direct `runTask` calls count as scheduled
In native mode, nuxt-task can't tell Nitro's scheduler apart from a direct `runTask()` call, or from Nitro's dev-only `/_nitro/tasks/:name` route. Those runs are recorded as `schedule`, with the most recent tick as `scheduledFor`. **Start manual runs with `triggerTask`.** It's the only way to guarantee `manual`.
:::

### `scheduledFor`

Nitro passes every scheduled run the same `scheduledTime`: the moment the server booted. nuxt-task works out the actual tick itself:

- **Native mode:** the latest occurrence of the task's schedule at or before the moment the run starts, in the server process's time zone (the zone Nitro's scheduler fires in). Nitro's `scheduledTime` is still passed to your handler unchanged.
- **Custom mode:** the occurrence the module's scheduler was running, including catch-up runs for missed ticks.

`scheduledFor` is `null` for manual runs.

## Hooks

Three hooks fire on `nitroApp.hooks`. Their types are added to `NitroRuntimeHooks`, so listeners are typed without an import.

| Hook | Payload | Fires |
|---|---|---|
| `task:run:start` | `{ run }` | when a run opens |
| `task:run:attempt-failed` | `{ run, attempt, error, retryInMs }` | after an attempt fails and another will follow, before the retry delay |
| `task:run:finish` | `{ run, status, result, error, durationMs }` | when a run closes |

In `task:run:finish`, `result` is the handler's raw return value (`undefined` on failure), and `error` is the error the run rethrew (`undefined` on success).

### Guarantees

- **Hooks never slow down a task.** The task doesn't wait for its listeners. A listener that takes ten seconds delays nothing.
- **Hooks never fail a task.** A listener that throws is logged once, and the other listeners still run. The run's status, result and error stay exactly as they were.
- **`finish` follows `start`.** For a given run, `finish` listeners start only after its `start` listeners have settled, so an insert can't race the matching update. Different runs don't wait for each other.
- **Snapshots, not live objects.** Each event carries a copy of the run as it was at that moment, so a listener that saves data later records the right values. `meta` is deep-copied; values that can't be cloned, such as functions, are copied shallowly.
- **Graceful shutdown.** When Nitro closes, nuxt-task waits up to five seconds for pending hook calls, so the last `finish` events aren't lost. You can call `flushTaskRunHooks(timeoutMs?)` yourself, for example in tests.

### Example: persisting run history

```ts
// server/plugins/task-runs.ts
import { eq } from 'drizzle-orm'

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('task:run:start', async ({ run }) => {
    await db.insert(taskRuns).values({
      id: run.runId,
      task: run.name,
      trigger: run.trigger,
      triggeredBy: run.triggeredBy ?? null,
      scheduledFor: run.scheduledFor,
      startedAt: run.startedAt,
      status: 'running',
    })
  })

  nitroApp.hooks.hook('task:run:attempt-failed', async ({ run, attempt, error }) => {
    await db.update(taskRuns)
      .set({ lastError: `attempt ${attempt}: ${String(error)}` })
      .where(eq(taskRuns.id, run.runId))
  })

  nitroApp.hooks.hook('task:run:finish', async ({ run, status, error, durationMs }) => {
    await db.update(taskRuns)
      .set({
        status,
        finishedAt: run.finishedAt,
        durationMs,
        attempts: run.attempt,
        error: error ? String(error) : null,
        traceId: (run.meta.traceId as string | undefined) ?? null,
        logs: (run.meta.logs as string[] | undefined) ?? [],
      })
      .where(eq(taskRuns.id, run.runId))
  })
})
```

The same listeners are a good place to push live updates to an admin screen over a socket.

## Run context

`getCurrentTaskRun()` returns the open run to any code a handler calls, however deeply nested and across any number of `await`s. It's backed by `AsyncLocalStorage`, so runs that overlap never see each other's context.

```ts
// server/utils/emails.ts — called from several tasks
export async function sendBatch(ids: string[]) {
  const run = getCurrentTaskRun()
  // run?.name is the task that called us, run?.runId the run
}
```

The returned object is live and read-only: `status` and `attempt` stay current, and assigning to any field throws. The exception is **`meta`**, a plain object you can write to. Whatever it holds when the run closes reaches `task:run:finish`:

```ts
async handler() {
  getCurrentTaskRun()!.meta.traceId = crypto.randomUUID()
  // ...
}
```

`getCurrentTaskRun()` returns `undefined` outside a run, inside hook listeners (they run outside the run's context on purpose), and on runtimes without `AsyncLocalStorage`, such as an edge preset without Node compatibility. Everything else in the run API still works on those runtimes.

### Example: attaching log lines to runs

nuxt-task doesn't capture logs and doesn't care which logger you use. To attach log lines to a run, have your logger check the run context:

```ts
// server/utils/logger.ts
export function log(level: 'info' | 'warn' | 'error', message: string) {
  console[level](message)

  const run = getCurrentTaskRun()
  if (run) {
    const logs = (run.meta.logs as string[] | undefined) ?? []
    logs.push(`${new Date().toISOString()} ${level} ${message}`)
    run.meta.logs = logs
  }
}
```

Any task, and any helper it calls, that logs through `log()` now files its lines under its run. The [persistence example](#example-persisting-run-history) saves them with the run. Because listeners run outside the run context, logging from a listener doesn't write into the run it's saving.

## Starting a task by hand

```ts
// server/api/tasks/[name]/run.post.ts
export default defineEventHandler(async (event) => {
  const name = getRouterParam(event, 'name')!
  const user = await requireAdmin(event)

  try {
    return await triggerTask(name, {
      payload: await readBody(event),
      triggeredBy: `user:${user.id}`,
      wait: false,
    })
  }
  catch (error) {
    if (error instanceof TaskAlreadyRunningError) {
      throw createError({ statusCode: 409, message: `${name} is already running` })
    }
    if (error instanceof TaskNotFoundError) {
      throw createError({ statusCode: 404, message: `No task named ${name}` })
    }
    throw error
  }
})
```

`triggerTask(name, options?)` resolves `{ runId, joined, result? }`. Its options:

| Option | Default | Meaning |
|---|---|---|
| `payload` | `{}` | Passed to the handler, as with `runTask`. |
| `context` | `{}` | Passed to the handler, as with `runTask`. |
| `runId` | a UUID | Your own id, for example a database row id. It must not match a run that's already open. |
| `triggeredBy` | none | Any string, passed to hooks unchanged. |
| `ifRunning` | `'reject'` | What to do if the task already has an open run. See below. |
| `wait` | `true` | `true` resolves when the run finishes, with the raw `result`, and rethrows the run's error. `false` resolves as soon as the run has started. |

### When the task is already running

Nitro's own `runTask` handles a task that's already running by quietly handing the caller the open run. The caller's payload is discarded, and nothing tells the caller. `triggerTask` makes that choice explicit:

- **`ifRunning: 'reject'`** (the default) throws `TaskAlreadyRunningError`. Its `runId` is the open run's id and its `taskName` is the task.
- **`ifRunning: 'join'`** attaches to the open run and ignores this call's payload. The result has `joined: true` and the open run's `runId`. With `wait: true` it resolves or rejects with that run's outcome.

Two `triggerTask` calls in the same tick can't both start a run: the first one reserves the task before anything asynchronous happens.

### Errors

| Error | When |
|---|---|
| `TaskAlreadyRunningError` | The task has an open run and `ifRunning` is `'reject'`. |
| `TaskNotFoundError` | No task has that path name. |
| `TaskRuntimeNotReadyError` | Called before nuxt-task's server plugin has run, or outside the Nitro server. |
| any other error | With `wait: true`, the handler's own error. |

## Listing tasks

`listTasks()` returns every registered task:

```ts
interface TaskInfo {
  name: string // path name
  metaName: string | undefined
  description: string | undefined
  schedule: string | undefined // undefined for an on-demand task
  options: Record<string, unknown> // literal values only
  parked: boolean // true when the schedule can never fire
}
```

The list is generated at build time from what nuxt-task already reads out of each task file, so it costs nothing at runtime and never loads task code. Two consequences:

- `schedule` is set only when it's a string literal in the file. A computed schedule makes the task on-demand only (the build prints a warning).
- `options` contains only values written as literals. `timeout: 5000` appears; `timeout: FIVE_SECONDS` doesn't.

`parked` is `true` for a schedule that is valid but can never fire. `0 0 30 2 *` (30 February) is the usual way to keep a task registered for manual runs only.

The list is empty until nuxt-task's server plugin has run. Each call returns copies, so changing them doesn't affect the registry.

## Next run times

`nextRun(nameOrExpression, from?)` returns the next fire time after `from` (default: now), as a `Date`.

```ts
nextRun('notifications:daily-reminders') // Date
nextRun('0 9 * * 1', new Date('2026-01-01')) // a bare expression works too
nextRun('maintenance:parked') // null — the schedule never fires
nextRun('backfill') // null — on-demand task
```

If the argument is a registered task name, that task's schedule is used. Otherwise the argument is treated as a cron expression. A string with no spaces that isn't a registered name throws `TaskNotFoundError`, and an invalid expression throws.

`nextRun` always follows the scheduler that actually fires your tasks, so its answer matches reality in each mode. The two modes differ in time zone:

::: warning Native mode fires in the server's time zone
Nitro's scheduler doesn't take a time zone, so native-mode tasks fire in the server process's zone. `nuxtTask.timezone` and a task's `options.timezone` don't change native fire times; they only set `ctx.timezone` for the handler. Set the `TZ` environment variable on the server to change when native tasks fire. `nextRun` reflects this.
:::

In custom mode, `nextRun` uses the module's own scheduler and its time-zone rules: the task's `options.timezone`, falling back to `nuxtTask.timezone`, or always `nuxtTask.timezone` when `strict: true`.

## Checking what's running

```ts
getRunningTasks() // TaskRun[] — snapshots of the open runs, oldest first
isTaskRunning('reports:weekly') // boolean
```

`isTaskRunning` is also `true` for a moment while a `triggerTask` call is starting the task, so checking it and then triggering is safe within one process. To do both in one step, just call `triggerTask` and handle `TaskAlreadyRunningError`.

## Differences between the modes

The API is the same in both modes. These differences come from the scheduler underneath:

| | Native (`experimental.tasks: true`) | Custom (default) |
|---|---|---|
| Who starts scheduled runs | Nitro's scheduler, through `runTask` | nuxt-task's own scheduler |
| `scheduledFor` | latest tick at or before the start, server time zone | the tick the scheduler is running |
| `nextRun` and `parked` | croner in the server time zone | the module's scheduler and time-zone rules |
| `triggerTask` starts the run through | Nitro's `runTask` | the task definition directly |
| Direct `runTask()` | works; recorded as `schedule` | not available |
| A tick while a scheduled run is open | Nitro hands the tick the open run; no new run | skipped |
| A tick while a `triggerTask` run is open | Nitro hands the tick the open run; no new run | a second run starts alongside |

## Multiple server instances

All of this is per process. The run registry, the run context and the hooks live in memory, so with several server instances each one sees only its own runs, and `TaskAlreadyRunningError` covers only the current process. If a task must never run twice across instances, use a database lock or a unique constraint around the work.

## Replacing per-task wrappers

If you wrapped each task's handler to track runs before 1.3.0, you can drop the wrappers:

| Before | With run tracking |
|---|---|
| A wrapper in every task file to record start and finish | One plugin listening to `task:run:start` and `task:run:finish` |
| Your own `AsyncLocalStorage` to tie logs to runs | `getCurrentTaskRun()`, with your own data in `meta` |
| Your own map of running tasks and a check before `runTask` | `triggerTask`, catching `TaskAlreadyRunningError` |
| A payload key marking a run as manual | `trigger`, which is set from the call path |
| A hand-kept list of schedules | `listTasks()` and `nextRun()` |

Keep app-specific information, such as display titles or who may run a task, in your own code, keyed by the path name.
