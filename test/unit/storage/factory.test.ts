import { describe, it, expect } from 'vitest'
import { createStorage } from './../../../src/runtime/utils/storage'
import { MemoryStorage } from './../../../src/runtime/utils/storage/memory'



describe('Storage Factory', () => {
    it('should create memory storage', () => {
        const storage = createStorage({ type: 'memory' })
        expect(storage).toBeInstanceOf(MemoryStorage)
    })

    it('should throw error for unimplemented redis storage', () => {
        expect(() => createStorage({ type: 'redis' }))
            .toThrow('Redis storage not implemented')
    })

    it('should throw error for unimplemented database storage', () => {
        expect(() => createStorage({ type: 'database' }))
            .toThrow('Database storage not implemented')
    })

    it('should throw error for unknown storage type', () => {
        expect(() => createStorage({ type: 'unknown' as any }))
            .toThrow('Unknown storage type: unknown')
    })
})