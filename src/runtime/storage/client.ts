import type { CronTask } from '../task/types'
import type { CronStorage, StorageConfig } from './types'
import { BaseStorage, type BaseStorageConfig } from './environments/base'
import { MemoryStorage } from './environments/memory'



export abstract class ClientBaseStorage extends BaseStorage implements CronStorage {
    protected abstract storage: Storage

    async init(): Promise<void> { }

    async add(Task: Omit<CronTask, 'id' | 'createdAt' | 'updatedAt'>): Promise<CronTask> {
        const newTask = this.createTaskObject(Task)

        this.storage.setItem(
            this.getKey(newTask.id),
            JSON.stringify(newTask),
        )

        return newTask
    }

    async get(id: string): Promise<CronTask | null> {
        const data = this.storage.getItem(this.getKey(id))
        if (!data) return null

        return JSON.parse(data)
    }

    async getAll(): Promise<CronTask[]> {
        const Tasks: CronTask[] = []

        for (let i = 0; i < this.storage.length; i++) {
            const key = this.storage.key(i)

            if (key?.startsWith(this.prefix)) {
                const data = this.storage.getItem(key)

                if (data) {
                    Tasks.push(JSON.parse(data))
                }
            }
        }

        return Tasks
    }

    async update(id: string, updates: Partial<CronTask>): Promise<CronTask> {
        const Task = await this.get(id)
        if (!Task) {
            throw new Error(`Task with id ${id} not found`)
        }

        const updatedTask = this.updateTaskObject(Task, updates)
        this.storage.setItem(this.getKey(id), JSON.stringify(updatedTask))

        return updatedTask
    }

    async remove(id: string): Promise<boolean> {
        const exists = await this.get(id)
        if (!exists) return false

        this.storage.removeItem(this.getKey(id))
        return true
    }

    async clear(): Promise<void> {
        for (let i = this.storage.length - 1; i >= 0; i--) {
            const key = this.storage.key(i)

            if (key?.startsWith(this.prefix)) {
                this.storage.removeItem(key)
            }
        }
    }
}

export class ClientLocalStorage extends ClientBaseStorage {
    protected storage: Storage = localStorage
    constructor(config?: BaseStorageConfig) {
        super(config)
    }
}

export class ClientSessionStorage extends ClientBaseStorage {
    protected storage: Storage = sessionStorage
    constructor(config?: BaseStorageConfig) {
        super(config)
    }
}

export async function createClientStorage(options: StorageConfig): Promise<CronStorage> {
    if (options.type === 'memory') {
        return new MemoryStorage()
    }

    if (options.type === 'localStorage') {
        const storage = new ClientLocalStorage(options.config)
        await storage.init()
        return storage
    }

    if (options.type === 'sessionStorage') {
        const storage = new ClientSessionStorage(options.config)
        await storage.init()
        return storage
    }

    throw new Error(`Storage type ${options.type} is not supported in browser environment`)
}
