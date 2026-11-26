# AGENTS.md

This file orients AI coding agents working inside the `nuxt-task` repository. It describes the codebase, its two execution modes, the build and test workflow, and the sharp edges to watch for. It is written for contributors editing this module, not for consumers installing it.

## Project overview

`nuxt-task` is a published Nuxt module (npm package `nuxt-task`, currently version 1.2.5, MIT, ESM-only) that adds cron-style scheduled task support to a Nuxt 3.10+ or Nuxt 4 application. Consumers author task files under `server/tasks` using a `defineTaskHandler` helper, give each task a 5-field cron schedule, and the module either delegates scheduling to Nitro's native experimental task runner or runs its own in-process scheduler. The module supports per-task timezone and retry options, on-demand triggering via Nitro's global `runTask`, and a build-time bundler that inlines a task file's local imports while keeping node_modules external for Nitro's dependency tracing. It is compatible with Nuxt `^3.10.0 || ^4.0.0`.

## Architecture map

All source lives under `src/`. The module entry is `src/module.ts`; everything the module ships to a consumer's server lives under `src/runtime/`.

- `src/module.ts` is the module entry. It is `defineNuxtModule<ModuleOptions>` with `meta.name = "nuxt-task"` and `meta.configKey = "nuxtTask"`. It wires aliases, runtime config, virtual modules, Nitro config, the server plugin, and build hooks. It also declares `BundlerOptions`, `BaseModuleOptions`, and `ModuleOptions`, and holds the two setup pipelines (`setupExperimentalTasks`, `setupCustomTasks`) plus their helpers (`setupModuleBasics`, `setupNitroBasics`, `setupVirtualTasksModule`, `generateVirtualTasksModule`, `configureNitroTasks`).
- `src/runtime/config.ts` defines `DEFAULT_MODULE_OPTIONS` (the module defaults) and the `ModuleConfiguration` class plus its `moduleConfiguration` singleton, which stores and validates options.
- `src/runtime/index.ts` is the runtime barrel that re-exports `defineTaskHandler` and the task types.
- `src/runtime/plugin.ts` is the Nitro server plugin used only in custom-scheduler mode. It loads tasks from the virtual `#tasks` module, builds a `Scheduler`, and starts it. Logic is decomposed into individually exported functions (`loadTasks`, `shouldSkipInitialization`, `initializeScheduler`, `addTasksToScheduler`, `initializePlugin`) with a thin `defineNitroPlugin` default export.
- `src/runtime/server/task/handler.ts` holds `defineTaskHandler` and its public types (`NuxtCronTaskDefinition`, `TaskMeta`, `TaskContext`). This is the public `nuxt-task/handler` subpath. It imports `useRuntimeConfig` explicitly from `nitropack/dist/runtime/config` (Nitro does not auto-import into a dependency; `nitropack/runtime` does not exist before nitropack 2.10).
- `src/runtime/scheduler/index.ts` is the `Scheduler` class (lifecycle, tick loop, next-run computation, timezone resolution, stats, persistence, event forwarding). `src/runtime/scheduler/queue.ts` is `TaskQueue` (Map-backed task store, execution with timeout and retry, pause/resume, lifecycle events). `src/runtime/scheduler/types.ts` holds scheduler option/stat/event types and the `createStrictModuleOptions`/`createFlexibleModuleOptions` factories.
- `src/runtime/storage/` is the pluggable persistence layer. `index.ts` is the barrel, `types.ts` defines `CronStorage`/`StorageConfig`/`StorageType`, `server.ts` is `createServerStorage` (memory only today), `client.ts` is the browser backends (`createClientStorage`, `ClientLocalStorage`, `ClientSessionStorage`), and `environments/` holds `BaseStorage` and `MemoryStorage`.
- `src/runtime/expression/parser.ts` is the `CronExpressionParser` (5-field parsing into per-field numeric arrays), with `types.ts` holding `CRON_RANGES`, `CronExpressionParseError`, and `cronPresets`. `index.ts` is a types-only barrel; the parser class is imported directly from `./parser`.
- `src/runtime/task/types.ts` defines the lower-level `CronTask`, `CronTaskOptions`, `CronTaskMetadata`, and `CronTaskStatus`. `src/runtime/task/validator.ts` is the `TaskValidator` class. `src/runtime/task/index.ts` holds `validateTaskTimezone`.
- `src/runtime/utils/` holds build-time discovery helpers: `scanTasks.ts` (recursive directory scan and task-name derivation), `extractTaskMeta.ts` (reads `meta`, `schedule` and literal `options` from a task file with magicast, without executing it), and `timezone.ts` (Luxon-based `TimezoneUtils`).
- `src/runtime/server/runs/` is run tracking, shared by both modes: `executor.ts` (`executeTaskRun`, the single path every run takes: retries, timeout, status, hooks, failure log), `state.ts` (the process-wide singleton on `globalThis[Symbol.for('nuxt-task:runs')]`: AsyncLocalStorage stores, open runs, reservations, attached `nitroApp`, trigger adapter, registry), `hooks.ts` (per-run serialised, fire-and-forget hook calls), `trigger.ts` (`triggerTask`), `registry.ts` (`listTasks`, `getCurrentTaskRun`, `getRunningTasks`, `isTaskRunning`), `schedule.ts` (`nextRun`, croner helpers, parked detection), `errors.ts`, `types.ts` (public types and the `NitroRuntimeHooks` augmentation), and `index.ts` (the public barrel, re-exported from `src/runtime/index.ts` and published as `nuxt-task/runtime`).
- `src/runtime/server/plugins/native.ts` is the native-mode Nitro plugin: it attaches `nitroApp`, Nitro's `runTask` (as the trigger adapter) and the registry to the run state.
- `src/runtime/scheduler/nextRun.ts` holds `computeNextRunTime`, the custom scheduler's next-occurrence search, taken out of `Scheduler` so `nextRun()` can call it with any `from` date.
- `src/types.d.ts` holds ambient TypeScript declarations that augment `#nuxt-task`, `@nuxt/schema`, `nuxt/schema`, and `@nuxt/kit`.

## The two execution modes

The module runs in exactly one of two mutually exclusive modes, selected only by `nuxtTask.experimental.tasks`. `setup(moduleOptions, nuxt)` calls `setupModuleBasics` first, then branches: a truthy `experimental?.tasks` calls `setupExperimentalTasks`, and anything else calls `setupCustomTasks`.

`setupModuleBasics` runs in both modes. It publishes options via `updateRuntimeConfig({ nuxtTask: moduleOptions })`, stores them in the `moduleConfiguration` singleton, sets the `#nuxt-task` and `#tasks` aliases, registers a `prepare:types` reference, and pushes `nuxt-task` onto `build.transpile`.

### Custom scheduler mode (default, `experimental.tasks = false`)

This is the default and what the playground uses. `setupCustomTasks` registers a `nitro:config` hook that calls `setupNitroBasics` and then `setupVirtualTasksModule`, which scans `<serverDir>/tasks` and installs a Nitro virtual module keyed `#tasks` that statically imports each task file and exports `taskDefinitions` plus an index-aligned `taskNames` (path names). It also publishes `#nuxt-task/registry`. Separately, `setup` calls `addServerPlugin(resolver.resolve('./runtime/plugin'))`, so the runtime scheduler plugin runs in the server. That plugin reads `#tasks`, attaches the run state (custom trigger adapter, registry, `nitroApp`), creates a `Scheduler` over memory storage, adds each task under its path name, and starts the tick loop. For `defineTaskHandler` definitions, `addTasksToScheduler` strips `maxRetries`/`timeout`/`retryDelay` from the queue options and calls the definition's `RUN_TASK_INTERNAL` method, so the run executor owns retries and the queue makes one call per run.

### Experimental native mode (`experimental.tasks = true`)

`setupExperimentalTasks` registers a `nitro:config` hook that calls `setupNitroBasics`, sets `nitroConfig.experimental.tasks = true`, sets `nitroConfig.externals.trace = true` (vercel/nft tracing), merges `bundler?.external` into `nitroConfig.externals.external`, and calls `configureNitroTasks`. `configureNitroTasks` scans task files, reads their metadata statically, de-duplicates task names, warns about schedules that can never fire, registers each task as `nitroConfig.tasks[name]` with `handler: fullTaskPath`, and groups scheduled tasks by cron string into `nitroConfig.scheduledTasks`. It registers no HTTP handlers: it used to string-key `nitroConfig.handlers`, which Nitro consumes as an array, so those routes were never served, and had they worked they would have been unauthenticated POST triggers for every task. Nitro itself serves `/_nitro/tasks*` in dev. It also publishes `#nuxt-task/registry`. The custom scheduler plugin and `#tasks` are not used in this mode (the custom plugin also self-skips when it detects `experimental.tasks`); instead `setup` registers `runtime/server/plugins/native`, which attaches the run state.

In both modes, when the module is running under a test environment (`import.meta.test`), `setup` logs `Skipping custom scheduler plugin in test environment` and returns early before registering the server plugin and the `nitro:build:before` hook.

## Key concepts

### ModuleOptions and defaults

Consumers configure the module under the `nuxtTask` key. `DEFAULT_MODULE_OPTIONS` (in `src/runtime/config.ts`) is declared once with `satisfies ModuleOptions` and reused as the module `defaults`:

```ts
{
  serverTasks: true,
  clientTasks: false,
  experimental: { tasks: false },
  storage: { type: 'memory' },
  timezone: { type: 'UTC', validate: true, strict: false },
  bundler: { external: [/node_modules/], inline: [] },
}
```

`timezone` is required on `ModuleOptions`. `serverTasks` defaults to `true` and is expected to be `true` when `experimental.tasks` is enabled. `clientTasks` defaults to `false`.

### Aliases: `#nuxt-task`, `#tasks`, and `tasks.virtual`

There are three related artifacts, and they are easy to confuse:

- `#nuxt-task` is a Nuxt alias set to the resolved `./runtime` directory. It is also set as a Nitro alias. Consumers import `defineTaskHandler` from `#nuxt-task`.
- `#tasks` as a Nuxt alias points to `<buildDir>/tasks.virtual`. The alias file name is `tasks.virtual`.
- `#tasks` as a Nitro virtual module is a distinct, generated module (static imports of each task file, `taskDefinitions`, `taskNames`). The custom runtime plugin imports it.
- `#nuxt-task/registry` is a Nitro virtual module in both modes exporting `taskRegistry` (the `listTasks()` data). `setupNitroBasics` installs an empty one so the plugins can always import it. Tests alias it to `test/mocks/registry.ts`.

`defineTaskHandler` is NOT auto-imported; import it from `#nuxt-task` or `nuxt-task/handler`. The run API (`RUN_API_IMPORTS` in `module.ts`) IS auto-imported via `addServerImports`, unless `nuxtTask.autoImports` is `false`.

### Run tracking

Every run in both modes goes through `executeTaskRun` (`src/runtime/server/runs/executor.ts`). Native mode reaches it from the `run()` that `defineTaskHandler` returns (Nitro passes the path name); custom mode reaches it through `RUN_TASK_INTERNAL`, a non-enumerable Symbol-keyed method that takes trusted inputs (path name, `scheduled.scheduledFor`) separately from the handler context. Rules worth keeping intact:

- The trigger comes from the call path only: a `triggerTask` reservation in the trigger AsyncLocalStorage (or the reservation map when AsyncLocalStorage is missing) means `manual`; being inside another run means `manual`; the custom scheduler's `scheduled` input means `schedule`; otherwise a task without a schedule is `manual` and one with a schedule is `schedule`, with `scheduledFor` computed as the latest croner occurrence at or before now. Never read the trigger from payload contents.
- The run is registered synchronously before the first await, so it is visible by the time Nitro stores its in-flight promise. `triggerTask` reserves the name synchronously, which closes the same-tick double-start race.
- Hooks are fire-and-forget, chained per run (`finish` after `start`), each listener in its own try/catch via `callHookWith`, and run outside the run's AsyncLocalStorage context. Snapshots deep-copy `meta`.
- `run()` still returns `{ success: true, ...result }`; hooks and `triggerTask` get the raw result. Non-Error throws are still wrapped as `Unknown error in task execution`.
- `defineTaskHandler` picks its branch from the scheduler that booted (`getRunState().mode`, which both plugins attach synchronously before any task module loads), then from `useRuntimeConfig().nuxtTask`, and only then from the build-time `moduleConfiguration` singleton, with a one-time warning. In a built app that singleton holds only the defaults.
- A run's name is the path name: the one Nitro's event or the custom scheduler passes, else the definition's entry in `definitionNames`, else the single registry entry whose `metaName` matches. `meta.name` stands in only when none of those is known, with a one-time warning. Naming a run by `meta.name` while the path name is known breaks `triggerTask`, whose reservation is keyed by path name.
- `nextRun` and `parked` follow the scheduler that fires the task: croner in the process zone for native mode (Nitro passes no timezone), `computeNextRunTime` under the strict/flexible rules for custom mode.
- All state is per process. Tests reset it with `resetTaskRuntime()`; `test/unit/runs/helpers.ts` has a harness that attaches either mode and a copy of Nitro's `runTask`.

### Storage types

`StorageType = 'memory' | 'redis' | 'database' | 'sessionStorage' | 'localStorage'`. In practice only `memory` works server-side today: `createServerStorage` handles only `{ type: 'memory' }` (dynamic import of `createMemoryStorage`) and throws otherwise. The custom-scheduler runtime plugin hard-codes `createServerStorage({ type: 'memory' })`, so a consumer's `storage.type` is effectively ignored by the running scheduler. Client-side, `createClientStorage` supports `memory`, `localStorage`, and `sessionStorage`. `redis` and `database` are advertised in the type union but have no implementation; `StorageConfig` does not even have a `redis` variant. All backends implement the single `CronStorage` interface and derive from `BaseStorage`, which sets a default key prefix of `cron:`.

### Timezone options

`ModuleOptions.timezone` is `FlexibleTimezoneOptions | StrictTimezoneOptions`, discriminated on the `strict` literal. Flexible mode (`strict: false`, the default) allows a per-task `options.timezone`. Strict mode (`strict: true`) forbids per-task timezones; `validateTaskTimezone` throws if a task supplies one, and `getActiveTimezone` forces the module timezone. Validation goes through Luxon via `TimezoneUtils`. Note that `getActiveTimezone` has a `!process.env.VITEST` guard that bypasses strict enforcement under Vitest, so strict behavior differs between test and production.

### Task file loading

Task files are never bundled or executed at build time. Metadata comes from `extractTaskMeta` (magicast parse), and the code is built by Nitro itself: native mode registers `handler: <absolute path>`, custom mode statically imports each file from `#tasks`. Task files can therefore use any import a Nitro server file can. This area was volatile in the past (a Rollup bundler was added in v1.2.0 and later removed), so test any change to task loading in a real `nuxi build`, not only in unit tests.

## Build, dev, test, and lint commands

The repo uses pnpm locally (`pnpm-lock.yaml`). Exact npm scripts from `package.json`:

```bash
npm run dev:prepare   # stub-build the module, generate type shims, prepare playground .nuxt types
npm run dev           # nuxi dev playground: start the local playground dev server
npm run dev:build     # nuxi build playground: production-build the playground
npm run prepack       # nuxt-module-build build: the real production build into dist/
npm run test          # vitest run: single non-watch run of the whole suite
npm run test:watch    # vitest watch
npm run test:build    # pack the module, nuxi build test/fixtures/built-app, boot it, assert run names
npm run test:types    # vue-tsc --noEmit in the module, then again in playground
npm run lint          # eslint . --fix (auto-fixes; lint:fix is identical)
npm run docs:dev      # vitepress dev docs
npm run docs:build    # vitepress build docs (output docs/.vitepress/dist)
npm run docs:preview  # vitepress preview docs
npm run release       # prepack + changelogen --release + npm publish + git push --follow-tags
```

Run `npm run dev:prepare` on a fresh checkout before `npm run dev`, `npm test`, or typechecking, otherwise generated `.nuxt` types and module stubs are missing and imports fail to resolve. CI (`.github/workflows/ci.yml`) runs `npm run dev:prepare` and then `npm run test:build` on push to `main` and PRs to `main`/`dev`. CI does NOT run the unit tests or lint, so run those locally. Docs auto-deploy to GitHub Pages via `.github/workflows/doc-deploy.yml` on push to `main`.

### Running the playground

`npm run dev` starts `playground/`, a small Nuxt app that imports the module via `modules: ['../src/module']`. It has example tasks under `playground/server/tasks/` and an API route at `playground/server/api/test.get.ts` that triggers a task with `runTask('example', { payload, context })`.

### How tests handle `#tasks`

The virtual `#tasks` module does not exist during tests, so it is mocked two ways. `vitest.config.ts` sets `resolve.alias` to remap `#tasks` to `test/mocks/tasks.ts` (which exports an empty `taskDefinitions` array), and `vitest.setup.ts` calls `vi.mock('#tasks', () => ({ taskDefinitions: [] }))`. Tests that need real scanned tasks use the `test/fixtures/nitro-tasks/` mini Nuxt app instead.

`nitropack/dist/runtime/config` only loads inside a Nitro build, so `vitest.config.ts` aliases it to `test/mocks/nitro-config.ts`, which reports the `moduleConfiguration` singleton as `nuxtTask`. Tests that need a different runtime config `vi.mock` it (see `test/unit/runs/naming.test.ts`).

### The built-app test

`npm run test:build` (`test/build/native.build.ts`, `vitest.build.config.ts`) runs `nuxt-module-build build`, copies `package.json` and `dist/` into `test/fixtures/built-app/node_modules/nuxt-task`, runs `nuxi build` there, boots `.output/server/index.mjs` and checks run names, `triggerTask`, and that the bundled handler imports `useRuntimeConfig`. The module must come from `node_modules`: loading `src/module` the way the playground does hides bugs that only appear when the runtime is a dependency. The child processes run without `VITEST`/`TEST`, because Nitro's schedule runner does not start under `std-env`'s `isTest`.

## Testing conventions

Tests use Vitest via `defineVitestConfig` from `@nuxt/test-utils/config`: `globals: true`, `environment: 'node'`, `include: ['test/**/*.test.ts']`, and `exclude` covering `node_modules` and `playground`. Coverage is enabled by default (`coverage.enabled: true`, provider `v8`, reporters text/json/html, include `src/**/*`), so even a plain `npm test` writes coverage reports.

Test files are named `*.test.ts` and live under `test/unit/**` in subfolders such as `task/`, `storage/`, `server/`, `expression/`, and `utils/`. Tests import implementation directly from `src/runtime/**` via relative paths, not from built `dist`. Despite `globals: true`, tests use explicit imports (`import { describe, it, expect } from 'vitest'`). Use `import type { ... }` for type-only imports.

## Code style conventions

Indentation is 4 spaces everywhere, enforced by both `.editorconfig` and an explicit ESLint rule (`['error', 4, { SwitchCase: 1, ... }]`). Files use LF line endings, UTF-8, trimmed trailing whitespace (except markdown), and a final newline. ESLint uses `createConfigForNuxt` from `@nuxt/eslint-config/flat` with `features.tooling: true` and `features.stylistic: true`, and includes `./playground` in `dirs.src`. `npm run lint` auto-fixes; there is no read-only lint script. Everything is ESM (`"type": "module"`), and config files use ESM. TypeScript config (`tsconfig.json`) extends the generated `.nuxt/tsconfig.json` and excludes `dist`, `node_modules`, and `playground`.

Structural conventions to preserve when editing: the module `setup` is split into small named helpers rather than one monolithic function; the runtime plugin is decomposed into individually exported testable functions; virtual/aliased imports use the `#nuxt-task`, `#tasks`, and `#nuxt-task/types` conventions; defaults are declared once with `satisfies ModuleOptions`; and task names are sanitized by replacing `:` and `-` with `_` when generating JS identifiers for the virtual module. Note that many existing test files have inconsistent indentation despite the rule.

## Gotchas

- Config key mismatch. The module's `configKey` and its `updateRuntimeConfig` key are both `nuxtTask`, but `src/types.d.ts` augments the config with a `cron` key and the runtime plugin reads `config.cron`. The plugin therefore falls back to `moduleConfiguration.getModuleOptions()` (the build-time singleton) rather than reading runtime config directly. `ModuleConfiguration.getModuleOptions` also reads `runtimeConfig.cron` when passed a runtime config. The test fixture `test/fixtures/nitro-tasks/nuxt.config.ts` still uses the legacy `cron` key. Consumers should use `nuxtTask`.
- `defineTaskHandler` is not auto-imported. It must be imported explicitly. See the code comment in `module.ts`.
- `defineTaskHandler` has two different `run` behaviors. In native mode (`experimental.tasks` on) it returns a Nitro task whose `run({ name, payload, context })` injects `name` and `timezone` into the handler ctx (pinned last, so a payload key cannot shadow them), honours `options.timezone`, `options.timeout`, `options.maxRetries` and `options.retryDelay`, and rethrows handler errors so Nitro records the run as failed. In custom mode it returns a virtual task whose `run(context)` passes the raw context through (taking the run's name from a string `context.name`, as on Nitro's `{ name, payload, context }` event), does not inject `name`/`timezone`, rethrows handler errors, and attaches a `_custom` marker. Both branches now run through `executeTaskRun`, so both honour `timeout`/`maxRetries`/`retryDelay` and log `[ nuxt-task ] Task "<path name>" failed:`. Cron-expression validation happens at execution time in the custom branch only: the native branch does not re-validate, because Nitro schedules with croner, whose grammar is wider than this module's parser (`0 0 * * 7`, `@daily`, six-field), and re-checking rejected valid schedules on every fire.
- `storage.type` is ignored by the running custom scheduler. `initializeScheduler` hard-codes memory storage.
- Client backends serialize tasks with JSON, so `Date` fields and the `execute` function are lost or corrupted on round-trip. Browser-persisted tasks are metadata snapshots, not runnable tasks.
- `redis` is an optional peer dependency (`peerDependenciesMeta.redis.optional = true`). It is only referenced as a string literal in the `StorageType` union; there is no redis code. It is also a devDependency so local build and tests have it. `database` is likewise unimplemented.
- Scheduling resolution is minute-level only. `calculateNextRunTime` zeroes seconds and adds at least one minute.
- `getNextRunTime` catches parse/calc errors, emits an `error` event (via `emitError`, which falls back to `console.error` when nothing is listening, since an unhandled `error` event would otherwise throw), and returns a fallback instead of throwing. An expression that can never fire is parked beyond the search horizon rather than retried every 24h; any other error still falls back to `now + 24h`.
- `computeNextRunTime` (`scheduler/nextRun.ts`) searches up to `MAX_NEXT_RUN_HORIZON_YEARS` (50) ahead and then throws `UnsatisfiableCronExpressionError`.
- For `defineTaskHandler` tasks in custom mode, retries happen inside the run executor, so the queue sees one call per run: `runCount` goes up once per run and the queue's `retry` event does not fire. Tasks added to the `Scheduler` directly keep the queue's own per-run retry budget.
- `maxConcurrent` is dereferenced with a non-null assertion in `tick()`. If undefined, `available` becomes `NaN` and no tasks execute.
- `stop()` calls `waitForTask`, which polls forever with no timeout. A hung task with no configured `timeout` prevents `stop()` from ever resolving.
- The parser diverges from standard cron in three ways: step-over-range uses index-based selection (`1-10/3` yields `[1,4,7,10]`), month `*/S` starts at 2 rather than 1, and day-of-month and day-of-week are ANDed by the scheduler rather than ORed (Vixie-style). There is no support for macros (`@daily`), named months/weekdays, or `?`/`L`/`W`/`#`. `dayOfWeek` accepts only 0-6 with 0 = Sunday (7 is rejected). `cronPresets` are plain 5-field strings, not `@` macros.
- The `ExpressionValidationOptions` (`allowAliases`, `allowSecondsField`, etc.) are declared but never read; they are dead config.
- `CronExpressionParseError` instances report `.name === 'CronParseError'`, which does not match the class name.
- `validateModuleOptions` exists in `ModuleConfiguration` but is not invoked in the setup path, so invalid combinations (for example `experimental.tasks` with `serverTasks: false`) are not actually blocked at setup time. Documentation says experimental tasks require server tasks, but nothing enforces it.
- If `<serverDir>/tasks` does not exist, both modes warn `No tasks directory found at:` and register no tasks.
- In test environments the module returns early before registering the server plugin and the `nitro:build:before` hook.
- `tasksDir` is declared on `BaseModuleOptions` but is dead config; the tasks directory is always `join(nuxt.options.serverDir, 'tasks')`.
- Metadata extraction needs `schedule` (and, for the registry, `meta.name` and `options` values) to be literals. A computed `schedule` registers the task as on-demand only, with a warning.
- In native mode a direct `runTask()` call, or Nitro's dev `/_nitro/tasks/:name` route, is recorded as `trigger: 'schedule'`: nuxt-task cannot tell it from Nitro's scheduler. Only `triggerTask` guarantees `manual`.
- Native mode fires in the process time zone. `nuxtTask.timezone` and per-task `options.timezone` only set `ctx.timezone` there.
- `runTask` returns `{ result }` and must be destructured; the handler's return value is nested under `result`.

## Where to make common changes

| If you want to change...                          | Edit...                                                                 |
| ------------------------------------------------- | ----------------------------------------------------------------------- |
| Module registration, aliases, mode branching      | `src/module.ts`                                                         |
| Default module options                            | `src/runtime/config.ts` (`DEFAULT_MODULE_OPTIONS`)                      |
| The `defineTaskHandler` API or its run semantics   | `src/runtime/server/task/handler.ts`                                   |
| The tick loop, next-run computation, timezones     | `src/runtime/scheduler/index.ts`                                       |
| Task execution, timeout, retry, pause/resume       | `src/runtime/scheduler/queue.ts`                                       |
| Cron expression parsing rules                      | `src/runtime/expression/parser.ts` and `expression/types.ts`           |
| Storage backends or the `CronStorage` contract     | `src/runtime/storage/` (`server.ts`, `client.ts`, `environments/`)     |
| Task file discovery and name derivation            | `src/runtime/utils/scanTasks.ts`                                       |
| Build-time task metadata                           | `src/runtime/utils/extractTaskMeta.ts`                                 |
| The native-mode task registration                  | `configureNitroTasks` in `module.ts`                                   |
| Run tracking (hooks, context, trigger, registry)    | `src/runtime/server/runs/`                                             |
| The native-mode runtime plugin                      | `src/runtime/server/plugins/native.ts`                                 |
| Timezone conversion/validation                     | `src/runtime/utils/timezone.ts`                                        |
| The runtime scheduler plugin (custom mode)          | `src/runtime/plugin.ts`                                                |
| Task option validation rules                       | `src/runtime/task/validator.ts`                                        |
| Ambient/config type augmentation                   | `src/types.d.ts`                                                       |
| Test mocks for `#tasks`                             | `test/mocks/tasks.ts`, `vitest.config.ts`, `vitest.setup.ts`           |
| The local demo app                                 | `playground/` (`nuxt.config.ts`, `server/tasks/`, `server/api/`)       |
