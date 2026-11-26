import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { createServer } from 'node:net'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const fixture = join(root, 'test/fixtures/built-app')
const installed = join(fixture, 'node_modules/nuxt-task')
const output = join(fixture, '.output')

// Without Vitest's markers: Nitro's schedule runner does not start when
// std-env reports a test environment, and the module skips its plugins.
function appEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: 'production', ...extra }
    for (const key of Object.keys(env)) {
        if (key === 'TEST' || key === 'VITEST' || key.startsWith('VITEST_')) delete env[key]
    }
    return env
}

function run(command: string, args: string[], cwd: string) {
    const result = spawnSync(command, args, { cwd, encoding: 'utf8', env: appEnv() })
    if (result.status !== 0) {
        throw new Error(`${command} ${args.join(' ')} failed (${result.status}):\n${result.stdout}\n${result.stderr}`)
    }
    return result.stdout + result.stderr
}

function freePort(): Promise<number> {
    return new Promise((done, fail) => {
        const server = createServer()
        server.on('error', fail)
        server.listen(0, () => {
            const address = server.address()
            server.close(() => done(typeof address === 'object' && address ? address.port : 0))
        })
    })
}

function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
        const path = join(dir, entry)
        return statSync(path).isDirectory() ? walk(path) : [path]
    })
}

async function waitFor<T>(probe: () => Promise<T | undefined>, timeout: number): Promise<T> {
    const deadline = Date.now() + timeout
    let last: unknown
    while (Date.now() < deadline) {
        try {
            const value = await probe()
            if (value !== undefined) return value
        }
        catch (error) {
            last = error
        }
        await new Promise(r => setTimeout(r, 200))
    }
    throw new Error(`Timed out after ${timeout}ms${last ? `: ${last}` : ''}`)
}

describe('built app, native mode, nuxt-task from node_modules', () => {
    let server: ChildProcess | undefined
    let base = ''
    let logs = ''

    beforeAll(async () => {
        // Pack exactly what npm publishes (package.json `files`: dist).
        run(join(root, 'node_modules/.bin/nuxt-module-build'), ['build'], root)

        rmSync(installed, { recursive: true, force: true })
        mkdirSync(installed, { recursive: true })
        cpSync(join(root, 'package.json'), join(installed, 'package.json'))
        cpSync(join(root, 'dist'), join(installed, 'dist'), { recursive: true })

        rmSync(output, { recursive: true, force: true })
        run(join(root, 'node_modules/.bin/nuxi'), ['build'], fixture)

        const port = await freePort()
        base = `http://127.0.0.1:${port}`
        server = spawn(process.execPath, [join(output, 'server/index.mjs')], {
            cwd: fixture,
            env: appEnv({ PORT: String(port), HOST: '127.0.0.1' }),
            stdio: ['ignore', 'pipe', 'pipe'],
        })
        server.stdout!.on('data', (d) => { logs += d })
        server.stderr!.on('data', (d) => { logs += d })

        await waitFor(async () => (await fetch(`${base}/api/runs`)).ok || undefined, 30_000)
    })

    afterAll(() => {
        server?.kill()
    })

    it('bundles the task handler with an explicit useRuntimeConfig import', () => {
        const chunks = walk(join(output, 'server')).filter(f => f.endsWith('.mjs'))
        const handler = chunks.find(f => readFileSync(f, 'utf8').includes('nuxt-task:run-internal'))

        expect(handler, 'chunk holding defineTaskHandler').toBeDefined()
        const source = readFileSync(handler!, 'utf8')
        // Bound by an import (or defined in the same chunk), never a bare global.
        expect(source).toMatch(/import\s*\{[^}]*\buseRuntimeConfig\b[^}]*\}\s*from|function useRuntimeConfig\(/)
    })

    it('names scheduled runs by path name in task:run:start', async () => {
        const runs = await waitFor(async () => {
            const recorded: any[] = await (await fetch(`${base}/api/runs`)).json()
            const starts = recorded.filter(r => r.hook === 'task:run:start')
            return starts.length > 0 ? starts : undefined
        }, 15_000)

        expect(runs[0]).toMatchObject({
            name: 'habit:demo',
            metaName: 'habit-demo',
            trigger: 'schedule',
        })
        expect(runs.every(r => /^[a-z0-9-]+:[a-z0-9-]+$/.test(r.name))).toBe(true)
    })

    it('triggerTask() claims its reservation: manual, path name, no TaskAlreadyRunningError', async () => {
        const response = await (await fetch(`${base}/api/trigger`, { method: 'POST' })).json()

        expect(response).toMatchObject({
            ok: true,
            result: {
                joined: false,
                result: {
                    currentName: 'reports:weekly',
                    running: expect.arrayContaining(['reports:weekly']),
                    isRunning: true,
                },
            },
        })

        const recorded: any[] = await (await fetch(`${base}/api/runs`)).json()
        expect(recorded).toContainEqual(expect.objectContaining({
            hook: 'task:run:start',
            name: 'reports:weekly',
            trigger: 'manual',
        }))
    })

    it('boots without falling back to the other scheduler', () => {
        expect(logs).not.toMatch(/\[ nuxt-task \].*(fall|meta\.name)/i)
        expect(existsSync(installed)).toBe(true)
    })
})
