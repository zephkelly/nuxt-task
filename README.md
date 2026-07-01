# nuxt-task

A reliable cron job library for Nuxt with Nitro task integration, multi-timezone support, and dynamic scheduling. Define scheduled tasks as files in `server/tasks`, give each one a cron expression, and let nuxt-task run them in your Nitro server.

## Features

- Custom in-process scheduler by default, with an optional experimental mode that delegates to Nitro's native task scheduler.
- Cron expression scheduling using standard 5-field expressions.
- Multi-timezone scheduling backed by Luxon, configurable per task or at the module level.
- Pluggable storage abstraction with an in-memory backend by default, and Redis reserved as an optional peer dependency for a future backend.
- Automatic task discovery from `server/tasks`, including nested subdirectories.
- Task files support the full range of Nitro server-file imports: relative, aliased (`~`, `~~`, `#imports`), server auto-imports, and node_modules dependencies.
- TypeScript types for the module options, the task definition helper, and the scheduler.

## Requirements

- Nuxt `^3.10.0 || ^4.0.0`.

## Installation

Install the package with your package manager of choice:

```bash
npm add nuxt-task
```

```bash
pnpm add nuxt-task
```

```bash
yarn add nuxt-task
```

Then add it to the `modules` array in `nuxt.config.ts`:

```ts
export default defineNuxtConfig({
  modules: ['nuxt-task'],
})
```

## Quick start

Configure the module under the `nuxtTask` key in `nuxt.config.ts`. The defaults are sensible, so a minimal setup only needs the module registered. Here is an explicit configuration using the custom scheduler:

```ts
export default defineNuxtConfig({
  modules: ['nuxt-task'],

  nuxtTask: {
    experimental: {
      tasks: false,
    },
    timezone: {
      type: 'UTC',
      validate: true,
      strict: false,
    },
  },
})
```

Create a task file at `server/tasks/example.ts`:

```ts
import { defineTaskHandler } from '#nuxt-task'

export default defineTaskHandler({
  meta: {
    name: 'example',
    description: 'An example scheduled task',
  },
  schedule: '14 23 * * *',
  options: {
    timezone: 'Australia/Sydney',
  },
  async handler(ctx) {
    console.log('Running example task', ctx)
    return { ran: true }
  },
})
```

With the module registered, the custom scheduler discovers the file, parses its cron schedule, and runs the handler automatically at each matching time. No extra wiring is required.

## Defining tasks

Each task lives in its own file under `server/tasks/` and default-exports the result of `defineTaskHandler`. The helper accepts a single object with four keys:

- `meta` (required): task metadata. `meta.name` is the task identifier and `meta.description` is optional.
- `schedule` (required): the cron expression as a 5-field string. The cron string lives at the top level of the definition, not inside `options`.
- `handler` (required): an async function that receives a context object and returns a value.
- `options` (optional): per-task options such as `timezone`, `maxRetries`, `retryDelay`, `timeout`, `exclusive`, and `catchUp`.

The handler receives a context object. You can read the whole object or destructure the parts you need:

```ts
import { defineTaskHandler } from '#nuxt-task'

export default defineTaskHandler({
  meta: {
    name: 'send-digest',
    description: 'Send the daily digest email',
  },
  schedule: '0 8 * * *',
  options: {
    timezone: 'UTC',
  },
  async handler(ctx) {
    // ...do work
    return { sent: true }
  },
})
```

The value your handler returns is expected to be an object. On success it is spread into a `{ success: true, ...result }` envelope, so avoid returning an object that already has a `success` key, since it would overwrite the wrapper's flag.

### Per-task options and the run limit

The supported per-task options are `timezone` (an IANA identifier), `maxRetries`, `retryDelay` (milliseconds), `timeout` (milliseconds), `exclusive` (a boolean that skips a run if the previous one is still running), and `catchUp` (a boolean that runs a task that was missed while the server was down).

Be aware of one current behavior of `maxRetries`. The run counter that tracks retries is also used as a total-run cap, so a task with `maxRetries` set stops executing after `maxRetries + 1` runs over the lifetime of the server process. A task with `maxRetries: 3` runs at most four times in total and then stops. For a task that should keep running on its schedule indefinitely, leave `maxRetries` unset.

### Nested task directories

Subdirectories under `server/tasks` are discovered recursively. A file at `server/tasks/db/migrate.ts` is a valid task. Its registered name is derived from the path: subdirectories are joined with colons and the file extension is dropped, so `db/migrate.ts` becomes `db:migrate`. Use that derived name when you trigger a task by name.

### Importing `defineTaskHandler`

Import `defineTaskHandler` explicitly. It is not a Nuxt auto-import. The module registers a `#nuxt-task` alias, which is the recommended import path:

```ts
import { defineTaskHandler } from '#nuxt-task'
```

You can also import it from the package's `./handler` subpath:

```ts
import { defineTaskHandler } from 'nuxt-task/handler'
```

`defineTaskHandler` itself is not registered as a Nuxt auto-import, so always add one of the imports above at the top of each task file. Everything else a task file depends on can be imported however you like — see [Imports in task files](#imports-in-task-files).

### Imports in task files

Aside from `defineTaskHandler`, a task file supports exactly the same imports as any other Nitro server file, in both execution modes:

- Relative imports (`../services/notification`).
- Aliased imports (`~/server/utils/db`, `~~/...`, `#imports`, and any custom subpath alias you have registered).
- Server auto-imports (functions from `server/utils`, `useRuntimeConfig()`, and so on), used without an explicit import statement.
- `node_modules` dependencies.

```ts
import { defineTaskHandler } from '#nuxt-task'
import { getPg } from '~/server/utils/db'          // aliased import
import { NotificationService } from '../services/notification' // relative import

export default defineTaskHandler({
  meta: { name: 'reminders' },
  schedule: '30 9 * * *',
  async handler() {
    const rows = await getPg().query('select 1')
    // logTaskRun() is auto-imported from server/utils
    logTaskRun('reminders')
    return NotificationService.send(`${rows.length} reminders`)
  },
})
```

Two things to keep in mind:

- Custom subpath aliases (for example `#db/client`) must be registered in `nuxt.options.alias`/`nitro.options.alias`, the same as for any server file.
- In experimental native mode, `schedule` must be a **string literal** so it can be read at build time. A computed or imported schedule value cannot be known when Nitro builds its schedule table, so the task is registered as on-demand only (triggerable with `runTask`, but not scheduled) and a build-time warning is logged. The custom scheduler has no such restriction because it reads the schedule at runtime.

## Triggering tasks on demand

Nitro exposes a global `runTask` helper that invokes a registered task by name. It relies on Nitro's task runner, so it is available when you opt into experimental mode with `experimental.tasks: true`:

```ts
export default defineNuxtConfig({
  modules: ['nuxt-task'],

  nuxtTask: {
    experimental: {
      tasks: true,
    },
  },
})
```

```ts
// server/api/run-example.get.ts
export default defineEventHandler(async () => {
  const { result } = await runTask('example', {
    payload: { foo: 'bar' },
    context: { baz: 'qux' },
  })

  return { success: true, data: result }
})
```

The name passed to `runTask` is the derived name described in [Nested task directories](#nested-task-directories), so a file at `server/tasks/example.ts` is triggered as `example` and one at `server/tasks/db/migrate.ts` as `db:migrate`. `runTask` returns an object whose `result` field holds whatever your handler returned.

## Cron expressions

Schedules use standard 5-field cron expressions in this field order:

```
minute  hour  day-of-month  month  day-of-week
```

Field ranges are as follows:

| Field        | Range | Notes                    |
|--------------|-------|--------------------------|
| minute       | 0-59  |                          |
| hour         | 0-23  |                          |
| day of month | 1-31  |                          |
| month        | 1-12  |                          |
| day of week  | 0-6   | 0 = Sunday. 7 is not accepted for Sunday. |

The parser supports:

- Wildcards: `*` expands to the full range for the field.
- Single values: `5`.
- Ranges: `1-5` (inclusive; the start must be less than or equal to the end).
- Steps: `*/5`, `10/2`, and `1-10/3`.
- Comma lists: `1,15,30`, where each item can itself be a value, range, or step.

Some examples:

| Expression      | Meaning                                   |
|-----------------|-------------------------------------------|
| `* * * * *`     | Every minute                              |
| `*/5 * * * *`   | Every five minutes                        |
| `0 * * * *`     | Every hour, on the hour                   |
| `0 0 * * *`     | Every day at midnight                     |
| `0 0 * * 0`     | Every Sunday at midnight                  |
| `0 0 1 * *`     | The first day of every month at midnight  |
| `14 23 * * *`   | Every day at 23:14                        |

The parser does not support cron macros such as `@daily` or `@hourly`, named months or weekdays such as `JAN` or `MON`, a seconds field, a year field, or dialect-specific characters such as `?`, `L`, `W`, and `#`. Only numeric fields are accepted.

A few behaviors are worth calling out explicitly:

- Scheduling resolution is minute-level. Seconds are zeroed, so the earliest a task can next run is the start of the next full minute.
- Steps applied over a range select elements by index rather than by value. For example `1-10/3` yields `1, 4, 7, 10`.
- The `*/S` step for the `month` field starts at `2` rather than `1`, so `*/3` for the month yields `2, 5, 8, 11`. This differs from some other cron implementations.
- Day-of-month and day-of-week are combined with a logical AND when both are restricted, which differs from the traditional OR behavior in Vixie cron.

## Configuration reference

All module options go under the `nuxtTask` key in `nuxt.config.ts`.

| Option                | Type                          | Default              | Description |
|-----------------------|-------------------------------|----------------------|-------------|
| `serverTasks`         | `boolean`                     | `true`               | Enable server-side tasks. Should be `true` when `experimental.tasks` is enabled. |
| `clientTasks`         | `boolean`                     | `false`              | Enable client-side tasks. |
| `tasksDir`            | `string`                      | (unused)             | Declared but not currently read. Task discovery always uses `server/tasks` under the Nuxt server directory. |
| `experimental.tasks`  | `boolean`                     | `false`              | When `true`, use Nitro's native experimental task scheduler instead of the bundled custom scheduler. |
| `storage.type`        | `StorageType`                 | `'memory'`           | Storage backend type. Only `memory` is implemented on the server today. |
| `storage.config`      | `Record<string, any>`         | (none)               | Optional backend-specific storage configuration. |
| `timezone.type`       | `string`                      | `'UTC'`              | Default IANA timezone used when a task does not set its own `options.timezone`. |
| `timezone.validate`   | `boolean`                     | `true`               | Whether to validate timezone strings. |
| `timezone.strict`     | `boolean`                     | `false`              | When `true`, forbid per-task timezones and force the module timezone for all tasks. |

A note on `tasksDir`: the option exists on the type but is not read by the current code. Tasks are always discovered in `server/tasks`. Treat `server/tasks` as the fixed location.

## Storage

nuxt-task uses a pluggable storage abstraction for task state, exposed through a single `CronStorage` interface. Every backend derives from a shared base class that handles id generation and key prefixing.

The server storage factory currently implements only the in-memory backend. In the custom scheduler, task state is held in memory for the lifetime of the server process. If the process restarts, in-memory task state is not carried over.

Redis is declared as an optional peer dependency (`redis ^4.7.0`, marked optional) and appears in the `StorageType` union, but there is no Redis backend implementation in the current source. Installing `redis` alone does not enable a Redis-backed scheduler yet. Treat Redis support as reserved for a future release rather than something you can select today.

On the client side, the storage layer additionally supports `localStorage` and `sessionStorage`, though the module's server scheduler uses in-memory storage.

Because only the memory backend is wired into the server scheduler, leaving `storage.type` at its default is the supported configuration.

## Timezones

Timezone handling is built on Luxon. There are two levels of configuration.

Module level, under `nuxtTask.timezone`:

```ts
export default defineNuxtConfig({
  nuxtTask: {
    timezone: {
      type: 'UTC',
      validate: true,
      strict: false,
    },
  },
})
```

- `type` is the default IANA timezone identifier, for example `'UTC'` or `'America/New_York'`.
- `validate` toggles timezone validation.
- `strict` controls whether per-task timezones are allowed.

Per task, through `options.timezone`:

```ts
export default defineTaskHandler({
  meta: { name: 'report' },
  schedule: '0 9 * * 1',
  options: {
    timezone: 'Australia/Sydney',
  },
  async handler() {
    return { ok: true }
  },
})
```

When `strict` is `false` (the default), a task may set its own `options.timezone` and it overrides the module default for that task. When `strict` is `true`, per-task timezones are rejected and the module-level timezone applies to every task. Next-run times are kept in UTC internally and converted for evaluation.

## Execution modes

nuxt-task runs in one of two mutually exclusive modes, selected by `experimental.tasks`.

### Custom scheduler (default)

With `experimental.tasks` set to `false`, the module registers its own Nitro server plugin. That plugin creates an in-process `Scheduler` that runs an interval-based tick loop. On each tick it evaluates registered tasks, runs those whose next-run time is due (subject to a concurrency cap), and recomputes their next-run time. Discovered task files are statically imported into a virtual `#tasks` module, so Nitro's own build resolves each task file's imports (relative, aliased, auto-imports, and node_modules) exactly as it would for any other server file. This is the mode used by the playground and is the default for consumers.

### Experimental native Nitro tasks

With `experimental.tasks` set to `true`, the module delegates scheduling to Nitro's native experimental task system. It enables `nitro.experimental.tasks` itself, registers your task files as Nitro tasks and handlers, and does not run the custom scheduler plugin. On-demand triggering with `runTask` is available in this mode. In this mode each task's `schedule` and `meta` are read statically from the task file at build time, so `schedule` must be a string literal to be scheduled (see [Imports in task files](#imports-in-task-files)).

Requirements and tradeoffs:

- Experimental mode expects `serverTasks` to be enabled.
- The two modes are mutually exclusive. Changing `experimental.tasks` changes how, and whether, tasks are scheduled.
- Native mode depends on a Nitro feature that is itself experimental, so behavior can vary by Nitro version.

Use the default custom scheduler for the module's own in-process scheduling. Use experimental mode to delegate scheduling to Nitro's native task runner.

## Development

The repository includes a playground app and a Vitest suite. Common scripts:

- `npm run dev:prepare`: stub the module build, generate type shims, and prepare the playground. Run this first on a fresh checkout.
- `npm run dev`: start the playground Nuxt dev server.
- `npm test`: run the Vitest suite once.
- `npm run lint`: run ESLint. Note that this auto-fixes files rather than only reporting.

Run `npm run dev:prepare` before `npm run dev` or `npm test` so generated types and stubs are in place.

## License

MIT.
