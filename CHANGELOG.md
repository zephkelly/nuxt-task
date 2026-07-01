# Changelog


## v1.2.7

[compare changes](https://github.com/zephkelly/nuxt-task/compare/v1.2.6...v1.2.7)

### 🩹 Fixes

- Native (experimental) mode no longer forces `@vercel/nft` dependency tracing in dev. Nitro's dev preset disables tracing on purpose; forcing it on made `nuxt dev` startup dramatically slower (tracing the full node_modules graph of every task's imports on each start). Tracing is now only enabled for production builds, where Nitro already traces by default.

## v1.2.6

[compare changes](https://github.com/zephkelly/nuxt-task/compare/v1.2.5...v1.2.6)

### 🩹 Fixes

- Task files can now use any import a Nitro server file supports — relative, aliased (`~`, `~~`, `#imports`), server auto-imports, and node_modules — in **both** execution modes. Previously a task file with an aliased or transitively-aliased import was silently dropped from the production build.

### 🚀 Enhancements

- Native (experimental) mode reads each task's `schedule`/`description` **statically** from source with `magicast` instead of executing the task file at build time. A non-literal `schedule` is registered as on-demand only, with a warning.
- Custom scheduler mode now generates the `#tasks` virtual module by statically importing each task file, letting Nitro resolve every import. This also fixes a doubled task-path bug.

### 💥 Behavior changes

- A task file that fails to compile or resolve is now a hard build error instead of being silently dropped.

### 🏡 Chore

- Removed the (unreleased) `bundler` module option and the Rollup/esbuild task bundler, replaced by the static approaches above.
- Added `magicast` as a dependency.

## v1.2.5

[compare changes](https://github.com/zephkelly/nuxt-task/compare/v1.2.4...v1.2.5)

### 🏡 Chore

- Revert 1.2.4 changes breaking task loading ([8b4e837](https://github.com/zephkelly/nuxt-task/commit/8b4e837))

### ❤️ Contributors

- Zephkelly <masterevank@gmail.com>

## v1.2.4

[compare changes](https://github.com/zephkelly/nuxt-task/compare/v1.2.3...v1.2.4)

### 🩹 Fixes

- LoadTask causing bundling issues with deps in tasks ([e3bfd4b](https://github.com/zephkelly/nuxt-task/commit/e3bfd4b))

### ❤️ Contributors

- Zephkelly <masterevank@gmail.com>

## v1.2.3

[compare changes](https://github.com/zephkelly/nuxt-task/compare/v1.2.2...v1.2.3)

### 🩹 Fixes

- Task bundler trying to import raw ts files ([4007c92](https://github.com/zephkelly/nuxt-task/commit/4007c92))

### ❤️ Contributors

- Zephkelly <masterevank@gmail.com>

## v1.2.2

[compare changes](https://github.com/zephkelly/nuxt-task/compare/v1.2.0...v1.2.2)

### 🏡 Chore

- Expand test code coverage in task handler ([1eba7f3](https://github.com/zephkelly/nuxt-task/commit/1eba7f3))
- **release:** V1.2.0 ([a92f323](https://github.com/zephkelly/nuxt-task/commit/a92f323))
- Merge changes with remote ([11db7ef](https://github.com/zephkelly/nuxt-task/commit/11db7ef))
- Remove comments in bundleTasks ([fee76fd](https://github.com/zephkelly/nuxt-task/commit/fee76fd))

### ✅ Tests

- Add test converage for server plugin ([2be230a](https://github.com/zephkelly/nuxt-task/commit/2be230a))

### ❤️ Contributors

- Zephkelly <masterevank@gmail.com>
- Ekelly <masterevank@gmail.com>

## v1.2.0

[compare changes](https://github.com/zephkelly/nuxt-task/compare/v1.1.0...v1.2.0)

### 🚀 Enhancements

- Add task bundler with esbuild rollup plugin ([c1394a2](https://github.com/zephkelly/nuxt-task/commit/c1394a2))

### ❤️ Contributors

- Zephkelly <masterevank@gmail.com>

## v1.1.0

[compare changes](https://github.com/zephkelly/nuxt-task/compare/v1.0.8...v1.1.0)

### 🚀 Enhancements

- Add import definitions to package.json ([271a381](https://github.com/zephkelly/nuxt-task/commit/271a381))

### ❤️ Contributors

- Zephkelly <masterevank@gmail.com>

## v1.0.8

[compare changes](https://github.com/zephkelly/nuxt-task/compare/v1.0.7...v1.0.8)

### 🏡 Chore

- Try and adjust import to include .js extension ([9388b6a](https://github.com/zephkelly/nuxt-task/commit/9388b6a))

### ❤️ Contributors

- Zephkelly <masterevank@gmail.com>

## v1.0.7

[compare changes](https://github.com/zephkelly/nuxt-task/compare/v1.0.6...v1.0.7)

### 🩹 Fixes

- Try to fix auto imports for server ([a4e3778](https://github.com/zephkelly/nuxt-task/commit/a4e3778))

### ❤️ Contributors

- Zephkelly <masterevank@gmail.com>

## v1.0.6

[compare changes](https://github.com/zephkelly/nuxt-task/compare/v1.0.5...v1.0.6)

### 🏡 Chore

- Add defineTaskHandler to server imports ([0b566bc](https://github.com/zephkelly/nuxt-task/commit/0b566bc))

### ❤️ Contributors

- Zephkelly <masterevank@gmail.com>

## v1.0.5

[compare changes](https://github.com/zephkelly/nuxt-task/compare/v1.0.4...v1.0.5)

### 🩹 Fixes

- Broken import paths for defineTaskHandler ([14872f2](https://github.com/zephkelly/nuxt-task/commit/14872f2))

### ❤️ Contributors

- Zephkelly <masterevank@gmail.com>

## v1.0.4

[compare changes](https://github.com/zephkelly/nuxt-task/compare/v1.0.3...v1.0.4)

### 🏡 Chore

- Try changing import method for task handler ([fbfe119](https://github.com/zephkelly/nuxt-task/commit/fbfe119))

### ❤️ Contributors

- Zephkelly <masterevank@gmail.com>

## v1.0.3

[compare changes](https://github.com/zephkelly/nuxt-task/compare/v1.0.2...v1.0.3)

### 🩹 Fixes

- Add runtime server task handler import to template definition ([5887ab5](https://github.com/zephkelly/nuxt-task/commit/5887ab5))

### ❤️ Contributors

- Zephkelly <masterevank@gmail.com>

## v1.0.2

[compare changes](https://github.com/zephkelly/nuxt-task/compare/v1.0.1...v1.0.2)

### 🩹 Fixes

- Import path of task handler was incorrect ([e10983c](https://github.com/zephkelly/nuxt-task/commit/e10983c))

### ❤️ Contributors

- Zephkelly <masterevank@gmail.com>

## v1.0.1


### 🩹 Fixes

- Add pathe as dependency ([0e4aa86](https://github.com/zephkelly/nuxt-task/commit/0e4aa86))

### 🏡 Chore

- Prepare for initial release ([c4de047](https://github.com/zephkelly/nuxt-task/commit/c4de047))

### ❤️ Contributors

- Zephkelly <masterevank@gmail.com>

