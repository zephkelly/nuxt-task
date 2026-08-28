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
- `src/runtime/server/task/handler.ts` holds `defineTaskHandler` and its public types (`NuxtCronTaskDefinition`, `TaskMeta`, `TaskContext`). This is the public `nuxt-task/handler` subpath.
- `src/runtime/scheduler/index.ts` is the `Scheduler` class (lifecycle, tick loop, next-run computation, timezone resolution, stats, persistence, event forwarding). `src/runtime/scheduler/queue.ts` is `TaskQueue` (Map-backed task store, execution with timeout and retry, pause/resume, lifecycle events). `src/runtime/scheduler/types.ts` holds scheduler option/stat/event types and the `createStrictModuleOptions`/`createFlexibleModuleOptions` factories.
- `src/runtime/storage/` is the pluggable persistence layer. `index.ts` is the barrel, `types.ts` defines `CronStorage`/`StorageConfig`/`StorageType`, `server.ts` is `createServerStorage` (memory only today), `client.ts` is the browser backends (`createClientStorage`, `ClientLocalStorage`, `ClientSessionStorage`), and `environments/` holds `BaseStorage` and `MemoryStorage`.
- `src/runtime/expression/parser.ts` is the `CronExpressionParser` (5-field parsing into per-field numeric arrays), with `types.ts` holding `CRON_RANGES`, `CronExpressionParseError`, and `cronPresets`. `index.ts` is a types-only barrel; the parser class is imported directly from `./parser`.
- `src/runtime/task/types.ts` defines the lower-level `CronTask`, `CronTaskOptions`, `CronTaskMetadata`, and `CronTaskStatus`. `src/runtime/task/validator.ts` is the `TaskValidator` class. `src/runtime/task/index.ts` holds `validateTaskTimezone`.
- `src/runtime/utils/` holds build-time discovery helpers: `scanTasks.ts` (recursive directory scan and task-name derivation), `loadTasks.ts` (dynamic import for the native path), `bundleTasks.ts` (Rollup + esbuild bundling for the custom path), and `timezone.ts` (Luxon-based `TimezoneUtils`).
- `src/types.d.ts` holds ambient TypeScript declarations that augment `#nuxt-task`, `@nuxt/schema`, `nuxt/schema`, and `@nuxt/kit`.

## The two execution modes

The module runs in exactly one of two mutually exclusive modes, selected only by `nuxtTask.experimental.tasks`. `setup(moduleOptions, nuxt)` calls `setupModuleBasics` first, then branches: a truthy `experimental?.tasks` calls `setupExperimentalTasks`, and anything else calls `setupCustomTasks`.

`setupModuleBasics` runs in both modes. It publishes options via `updateRuntimeConfig({ nuxtTask: moduleOptions })`, stores them in the `moduleConfiguration` singleton, sets the `#nuxt-task` and `#tasks` aliases, registers a `prepare:types` reference, and pushes `nuxt-task` onto `build.transpile`.

### Custom scheduler mode (default, `experimental.tasks = false`)

This is the default and what the playground uses. `setupCustomTasks` registers a `nitro:config` hook that calls `setupNitroBasics` and then `setupVirtualTasksModule`, which scans `<serverDir>/tasks`, bundles each task file, and installs a Nitro virtual module keyed `#tasks` whose contents are the bundled task code plus an `export const taskDefinitions = [...]`. Separately, `setup` calls `addServerPlugin(resolver.resolve('./runtime/plugin'))`, so the runtime scheduler plugin runs in the server. That plugin reads `taskDefinitions` from `#tasks`, creates a `Scheduler` over memory storage, adds each task, and starts the tick loop.

### Experimental native mode (`experimental.tasks = true`)

`setupExperimentalTasks` registers a `nitro:config` hook that calls `setupNitroBasics`, sets `nitroConfig.experimental.tasks = true`, sets `nitroConfig.externals.trace = true` (vercel/nft tracing), merges `bundler?.external` into `nitroConfig.externals.external`, and calls `configureNitroTasks`. `configureNitroTasks` scans task files, reads their metadata statically, de-duplicates task names, warns about schedules that can never fire, registers each task as `nitroConfig.tasks[name]` with `handler: fullTaskPath`, and groups scheduled tasks by cron string into `nitroConfig.scheduledTasks`. It registers no HTTP handlers: it used to string-key `nitroConfig.handlers`, which Nitro consumes as an array, so those routes were never served, and had they worked they would have been unauthenticated POST triggers for every task. Nitro itself serves `/_nitro/tasks*` in dev. No custom server plugin and no `#tasks` virtual module are used in this mode. The runtime plugin also self-skips when it detects `experimental.tasks`.

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
- `#tasks` as a Nitro virtual module is a distinct, in-memory generated module (bundled task code plus `taskDefinitions`). The runtime plugin imports `#tasks` to read `taskDefinitions`.

`defineTaskHandler` is NOT auto-imported. `addServerImports` is imported in `module.ts` but never called; a code comment explains that auto-imports do not work during task loading, which happens at Nitro config time. It must be imported explicitly from `#nuxt-task` (or the `nuxt-task/handler` package subpath).

### Storage types

`StorageType = 'memory' | 'redis' | 'database' | 'sessionStorage' | 'localStorage'`. In practice only `memory` works server-side today: `createServerStorage` handles only `{ type: 'memory' }` (dynamic import of `createMemoryStorage`) and throws otherwise. The custom-scheduler runtime plugin hard-codes `createServerStorage({ type: 'memory' })`, so a consumer's `storage.type` is effectively ignored by the running scheduler. Client-side, `createClientStorage` supports `memory`, `localStorage`, and `sessionStorage`. `redis` and `database` are advertised in the type union but have no implementation; `StorageConfig` does not even have a `redis` variant. All backends implement the single `CronStorage` interface and derive from `BaseStorage`, which sets a default key prefix of `cron:`.

### Timezone options

`ModuleOptions.timezone` is `FlexibleTimezoneOptions | StrictTimezoneOptions`, discriminated on the `strict` literal. Flexible mode (`strict: false`, the default) allows a per-task `options.timezone`. Strict mode (`strict: true`) forbids per-task timezones; `validateTaskTimezone` throws if a task supplies one, and `getActiveTimezone` forces the module timezone. Validation goes through Luxon via `TimezoneUtils`. Note that `getActiveTimezone` has a `!process.env.VITEST` guard that bypasses strict enforcement under Vitest, so strict behavior differs between test and production.

### The task bundler and why it exists

In custom-scheduler mode, task files are bundled at build time by `bundleTaskFile`/`bundleTaskFiles` (`src/runtime/utils/bundleTasks.ts`) using Rollup with `rollup-plugin-esbuild` (target `es2020`) and `@rollup/plugin-node-resolve`. The bundler inlines a task file's relative and local imports into one ESM module while keeping framework packages and node_modules external. This exists because raw task-file handlers cannot reliably use relative imports, and Nitro's nft tracer needs node_modules kept external so it can trace them (and so packages relying on Node globals like `File` and `Blob` keep working). External resolution order inside the Rollup `external` function is: user `inline` patterns win first (bundle), then `FRAMEWORK_EXTERNALS` regexes (external), then user `external` patterns (external), otherwise bundle. `FRAMEWORK_EXTERNALS` always externalizes `nuxt-task`, `#nuxt-task`, `nitropack`, `h3`, `@nuxt/*`, `nuxt`, `vue`, and `node:*`. String patterns in `external`/`inline` match by substring `includes`, so prefer RegExp for precision.

This area has been volatile. The changelog records the bundler being added in v1.2.0, a fix in v1.2.3 for importing raw `.ts` files, an attempted `loadTask` fix in v1.2.4 that was reverted in v1.2.5 because it broke task loading, and a further attempt in commit `3002e34`. Treat bundling and task-loading behavior as fragile and test any change to it carefully.

## Build, dev, test, and lint commands

The repo uses pnpm locally (`pnpm-lock.yaml`). Exact npm scripts from `package.json`:

```bash
npm run dev:prepare   # stub-build the module, generate type shims, prepare playground .nuxt types
npm run dev           # nuxi dev playground: start the local playground dev server
npm run dev:build     # nuxi build playground: production-build the playground
npm run prepack       # nuxt-module-build build: the real production build into dist/
npm run test          # vitest run: single non-watch run of the whole suite
npm run test:watch    # vitest watch
npm run test:types    # vue-tsc --noEmit in the module, then again in playground
npm run lint          # eslint . --fix (auto-fixes; lint:fix is identical)
npm run docs:dev      # vitepress dev docs
npm run docs:build    # vitepress build docs (output docs/.vitepress/dist)
npm run docs:preview  # vitepress preview docs
npm run release       # prepack + changelogen --release + npm publish + git push --follow-tags
```

Run `npm run dev:prepare` on a fresh checkout before `npm run dev`, `npm test`, or typechecking, otherwise generated `.nuxt` types and module stubs are missing and imports fail to resolve. CI (`.github/workflows/ci.yml`) runs only `npm run dev:prepare` as a build/prepare smoke check on push to `main` and PRs to `main`/`dev`. CI does NOT run the tests or lint, so run those locally. Docs auto-deploy to GitHub Pages via `.github/workflows/doc-deploy.yml` on push to `main`.

### Running the playground

`npm run dev` starts `playground/`, a small Nuxt app that imports the module via `modules: ['../src/module']`. It has example tasks under `playground/server/tasks/` and an API route at `playground/server/api/test.get.ts` that triggers a task with `runTask('example', { payload, context })`.

### How tests handle `#tasks`

The virtual `#tasks` module does not exist during tests, so it is mocked two ways. `vitest.config.ts` sets `resolve.alias` to remap `#tasks` to `test/mocks/tasks.ts` (which exports an empty `taskDefinitions` array), and `vitest.setup.ts` calls `vi.mock('#tasks', () => ({ taskDefinitions: [] }))`. Tests that need real scanned tasks use the `test/fixtures/nitro-tasks/` mini Nuxt app instead.

## Testing conventions

Tests use Vitest via `defineVitestConfig` from `@nuxt/test-utils/config`: `globals: true`, `environment: 'node'`, `include: ['test/**/*.test.ts']`, and `exclude` covering `node_modules` and `playground`. Coverage is enabled by default (`coverage.enabled: true`, provider `v8`, reporters text/json/html, include `src/**/*`), so even a plain `npm test` writes coverage reports.

Test files are named `*.test.ts` and live under `test/unit/**` in subfolders such as `task/`, `storage/`, `server/`, `expression/`, and `utils/`. Tests import implementation directly from `src/runtime/**` via relative paths, not from built `dist`. Despite `globals: true`, tests use explicit imports (`import { describe, it, expect } from 'vitest'`). Use `import type { ... }` for type-only imports.

## Code style conventions

Indentation is 4 spaces everywhere, enforced by both `.editorconfig` and an explicit ESLint rule (`['error', 4, { SwitchCase: 1, ... }]`). Files use LF line endings, UTF-8, trimmed trailing whitespace (except markdown), and a final newline. ESLint uses `createConfigForNuxt` from `@nuxt/eslint-config/flat` with `features.tooling: true` and `features.stylistic: true`, and includes `./playground` in `dirs.src`. `npm run lint` auto-fixes; there is no read-only lint script. Everything is ESM (`"type": "module"`), and config files use ESM. TypeScript config (`tsconfig.json`) extends the generated `.nuxt/tsconfig.json` and excludes `dist`, `node_modules`, and `playground`.

Structural conventions to preserve when editing: the module `setup` is split into small named helpers rather than one monolithic function; the runtime plugin is decomposed into individually exported testable functions; virtual/aliased imports use the `#nuxt-task`, `#tasks`, and `#nuxt-task/types` conventions; defaults are declared once with `satisfies ModuleOptions`; and task names are sanitized by replacing `:` and `-` with `_` when generating JS identifiers for the virtual module. Note that many existing test files have inconsistent indentation despite the rule.

## Gotchas

- Config key mismatch. The module's `configKey` and its `updateRuntimeConfig` key are both `nuxtTask`, but `src/types.d.ts` augments the config with a `cron` key and the runtime plugin reads `config.cron`. The plugin therefore falls back to `moduleConfiguration.getModuleOptions()` (the build-time singleton) rather than reading runtime config directly. `ModuleConfiguration.getModuleOptions` also reads `runtimeConfig.cron` when passed a runtime config. The test fixture `test/fixtures/nitro-tasks/nuxt.config.ts` still uses the legacy `cron` key. Consumers should use `nuxtTask`.
- `defineTaskHandler` is not auto-imported. It must be imported explicitly. See the code comment in `module.ts`.
- `defineTaskHandler` has two different `run` behaviors. In native mode (`experimental.tasks` on) it returns a Nitro task whose `run({ name, payload, context })` injects `name` and `timezone` into the handler ctx (pinned last, so a payload key cannot shadow them), honours `options.timezone`, `options.timeout`, `options.maxRetries` and `options.retryDelay`, and rethrows handler errors so Nitro records the run as failed. In custom mode it returns a virtual task whose `run(context)` passes the raw context through, does not inject `name`/`timezone`, rethrows handler errors, and attaches a `_custom` marker. Cron-expression validation happens at execution time in the custom branch only: the native branch does not re-validate, because Nitro schedules with croner, whose grammar is wider than this module's parser (`0 0 * * 7`, `@daily`, six-field), and re-checking rejected valid schedules on every fire.
- `storage.type` is ignored by the running custom scheduler. `initializeScheduler` hard-codes memory storage.
- Client backends serialize tasks with JSON, so `Date` fields and the `execute` function are lost or corrupted on round-trip. Browser-persisted tasks are metadata snapshots, not runnable tasks.
- `redis` is an optional peer dependency (`peerDependenciesMeta.redis.optional = true`). It is only referenced as a string literal in the `StorageType` union; there is no redis code. It is also a devDependency so local build and tests have it. `database` is likewise unimplemented.
- Scheduling resolution is minute-level only. `calculateNextRunTime` zeroes seconds and adds at least one minute.
- `getNextRunTime` catches parse/calc errors, emits an `error` event (via `emitError`, which falls back to `console.error` when nothing is listening, since an unhandled `error` event would otherwise throw), and returns a fallback instead of throwing. An expression that can never fire is parked beyond the search horizon rather than retried every 24h; any other error still falls back to `now + 24h`.
- `calculateNextRunTime` has an unbounded `while (true)` loop. An unsatisfiable expression (impossible day/month combination) would loop indefinitely.
- `runCount` doubles as the total-run counter and the retry/attempt gate. A task with a positive `maxRetries` stops executing after `maxRetries + 1` total lifetime runs, not per occurrence, because `runCount` increments on every execution. Both omitting `maxRetries` and setting `maxRetries: 0` leave the task uncapped: the guard is `task.options.maxRetries ? (... ) : -1`, and `0` is falsy, so the inner `=== 0 ? 0` branch is unreachable dead code.
- `maxConcurrent` is dereferenced with a non-null assertion in `tick()`. If undefined, `available` becomes `NaN` and no tasks execute.
- `stop()` calls `waitForTask`, which polls forever with no timeout. A hung task with no configured `timeout` prevents `stop()` from ever resolving.
- The parser diverges from standard cron in three ways: step-over-range uses index-based selection (`1-10/3` yields `[1,4,7,10]`), month `*/S` starts at 2 rather than 1, and day-of-month and day-of-week are ANDed by the scheduler rather than ORed (Vixie-style). There is no support for macros (`@daily`), named months/weekdays, or `?`/`L`/`W`/`#`. `dayOfWeek` accepts only 0-6 with 0 = Sunday (7 is rejected). `cronPresets` are plain 5-field strings, not `@` macros.
- The `ExpressionValidationOptions` (`allowAliases`, `allowSecondsField`, etc.) are declared but never read; they are dead config.
- `CronExpressionParseError` instances report `.name === 'CronParseError'`, which does not match the class name.
- `validateModuleOptions` exists in `ModuleConfiguration` but is not invoked in the setup path, so invalid combinations (for example `experimental.tasks` with `serverTasks: false`) are not actually blocked at setup time. Documentation says experimental tasks require server tasks, but nothing enforces it.
- If `<serverDir>/tasks` does not exist, both modes warn `No tasks directory found at:` and register no tasks.
- In test environments the module returns early before registering the server plugin and the `nitro:build:before` hook.
- `tasksDir` is declared on `BaseModuleOptions` but is dead config; the tasks directory is always `join(nuxt.options.serverDir, 'tasks')`.
- The virtual module generator rewrites `export default` to a const with a regex that matches only the first occurrence, so each task file must have exactly one `export default`.
- The bundler writes temp `.mjs` files to `os.tmpdir()` and imports them to read metadata; Rollup `onwarn` silently swallows `UNRESOLVED_IMPORT` and `MISSING_EXPORT`, so genuinely broken imports in a task file may not surface as build errors.
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
| The custom-mode bundler (external/inline behavior)  | `src/runtime/utils/bundleTasks.ts`                                     |
| The native-mode module loading                     | `src/runtime/utils/loadTasks.ts` and `configureNitroTasks` in `module.ts` |
| Timezone conversion/validation                     | `src/runtime/utils/timezone.ts`                                        |
| The runtime scheduler plugin (custom mode)          | `src/runtime/plugin.ts`                                                |
| Task option validation rules                       | `src/runtime/task/validator.ts`                                        |
| Ambient/config type augmentation                   | `src/types.d.ts`                                                       |
| Test mocks for `#tasks`                             | `test/mocks/tasks.ts`, `vitest.config.ts`, `vitest.setup.ts`           |
| The local demo app                                 | `playground/` (`nuxt.config.ts`, `server/tasks/`, `server/api/`)       |
