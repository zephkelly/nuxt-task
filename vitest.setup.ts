import { vi } from 'vitest'

// Mock the virtual #tasks module for all tests
// This prevents Vite from trying to resolve it during test builds
vi.mock('#tasks', () => ({
    taskDefinitions: [],
}))