import { describe, it, expect, afterAll } from 'vitest';
import { rollup } from 'rollup';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import typescript from '@rollup/plugin-typescript';
import * as path from 'path';



async function analyzeBundleContent(entryPoint: string) {
    const bundle = await rollup({
        input: entryPoint,
        plugins: [
            nodeResolve({
                extensions: ['.ts'],
                preferBuiltins: true
            }),
            typescript({
                tsconfig: './tsconfig.json',
                compilerOptions: {
                    declaration: false,
                    sourceMap: false,
                    moduleResolution: 'node',
                    outDir: './test/temp'
                }
            })
        ],
        treeshake: {
            moduleSideEffects: false,
            propertyReadSideEffects: false
        },
        onwarn(warning, warn) {
            if (warning.code === 'THIS_IS_UNDEFINED') return;
            warn(warning);
        }
    });

    const { output } = await bundle.generate({
        format: 'es',
        sourcemap: false
    });

    await bundle.close();
    return output[0].code;
}

// Create temp directory for test files
const fs = require('fs');
const testTempDir = path.resolve(__dirname, 'temp');
if (!fs.existsSync(testTempDir)) {
    fs.mkdirSync(testTempDir, { recursive: true });
}

describe('Tree Shaking Tests', () => {
    afterAll(() => {
        if (fs.existsSync(testTempDir)) {
            fs.rmSync(testTempDir, { recursive: true });
        }
    });

    // Test browser environment
    it('should not include Redis code in browser bundle', async () => {
        const browserTestCode = `
            import { createBrowserStorage } from './../../../src/runtime/utils/storage';
            
            export async function initStorage() {
                return createBrowserStorage({ 
                    type: 'localStorage',
                    config: { prefix: 'test:' }
                });
            }
        `;

        const testFilePath = path.resolve(testTempDir, 'browser-test.ts');
        fs.writeFileSync(testFilePath, browserTestCode);

        try {
            const bundleContent = await analyzeBundleContent(testFilePath);
            expect(bundleContent).not.toContain('redis');
            expect(bundleContent).not.toContain('createRedisStorage');
            expect(bundleContent).toContain('localStorage');
            expect(bundleContent).toContain('BrowserStorageBase');
        } finally {
            if (fs.existsSync(testFilePath)) {
                fs.unlinkSync(testFilePath);
            }
        }
    });

    // Test server environment
    it('should not include browser storage code in server bundle', async () => {
        const serverTestCode = `
            import { createRedisStorage } from './../../../src/runtime/utils/storage';
            
            export async function initStorage() {
                return createRedisStorage({ 
                    url: 'redis://localhost:6379',
                    prefix: 'test:'
                });
            }
        `;

        const testFilePath = path.resolve(testTempDir, 'server-test.ts');
        fs.writeFileSync(testFilePath, serverTestCode);

        try {
            const bundleContent = await analyzeBundleContent(testFilePath);
            expect(bundleContent).not.toContain('localStorage');
            expect(bundleContent).not.toContain('sessionStorage');
            expect(bundleContent).not.toContain('BrowserStorageBase');
            expect(bundleContent).toContain('redis');
            expect(bundleContent).toContain('createRedisStorage');
        } finally {
            if (fs.existsSync(testFilePath)) {
                fs.unlinkSync(testFilePath);
            }
        }
    });

    // Test memory storage
    it('should include only memory storage when specified', async () => {
        const memoryTestCode = `
            import { createMemoryStorage } from './../../../src/runtime/utils/storage';
            
            export async function initStorage() {
                return createMemoryStorage();
            }
        `;

        const testFilePath = path.resolve(testTempDir, 'memory-test.ts');
        fs.writeFileSync(testFilePath, memoryTestCode);

        try {
            const bundleContent = await analyzeBundleContent(testFilePath);
            expect(bundleContent).toContain('MemoryStorage');
            expect(bundleContent).not.toContain('redis');
            expect(bundleContent).not.toContain('localStorage');
            expect(bundleContent).not.toContain('sessionStorage');
        } finally {
            if (fs.existsSync(testFilePath)) {
                fs.unlinkSync(testFilePath);
            }
        }
    });
});