import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect, afterAll } from 'vitest'

import { rollup } from 'rollup'
import { nodeResolve } from '@rollup/plugin-node-resolve'
import typescript from '@rollup/plugin-typescript'

async function analyzeBundleContent(entryPoint: string) {
        const bundle = await rollup({
                input: entryPoint,
                plugins: [
                        nodeResolve({
                                extensions: ['.ts'],
                                preferBuiltins: true,
                        }),
                        typescript({
                                tsconfig: './tsconfig.json',
                                compilerOptions: {
                                        declaration: false,
                                        sourceMap: false,
                                        moduleResolution: 'node',
                                        outDir: './test/temp',
                                },
                        }),
                ],
                treeshake: {
                        moduleSideEffects: false,
                        propertyReadSideEffects: false,
                },
                onwarn(warning, warn) {
                        if (warning.code === 'THIS_IS_UNDEFINED') return
      warn(warning)
    },
        })

  const { output } = await bundle.generate({
                format: 'es',
                sourcemap: false,
        })

  await bundle.close()
  return output[0].code
}

const testTempDir = path.resolve(__dirname, 'temp')
if (!fs.existsSync(testTempDir)) {
        fs.mkdirSync(testTempDir, { recursive: true })
}

describe('Tree Shaking Tests', () => {
        afterAll(() => {
                if (fs.existsSync(testTempDir)) {
                        fs.rmSync(testTempDir, { recursive: true })
    }
        })

  it('should include only memory storage when specified', async () => {
                const memoryTestCode = `
            import { createMemoryStorage } from './../../../src/runtime/storage/environments';
            
            export async function initStorage() {
                return createMemoryStorage();
            }
        `

    const testFilePath = path.resolve(testTempDir, 'memory-test.ts')
    fs.writeFileSync(testFilePath, memoryTestCode)

    try {
                        const bundleContent = await analyzeBundleContent(testFilePath)
      expect(bundleContent).toContain('MemoryStorage')
      expect(bundleContent).not.toContain('localStorage')
      expect(bundleContent).not.toContain('sessionStorage')
    }
    finally {
                        if (fs.existsSync(testFilePath)) {
                                fs.unlinkSync(testFilePath)
      }
                }
        }, 30000)
})
