import type { CronTask } from '../../../types/task'
import type { CronStorage } from '../types'

import { BaseStorage } from './base'



export class MemoryStorage extends BaseStorage implements CronStorage {
    private Tasks: Map<string, CronTask> = new Map()

    async init(): Promise<void> { }

    async add(Task: CronTask | Omit<CronTask, 'id' | 'metadata'>): Promise<CronTask> {
        if ('id' in Task && 'metadata' in Task) {
            const existingTask = Task as CronTask;

            if (this.Tasks.has(existingTask.id)) {
                throw new Error(`Task with id ${existingTask.id} already exists`);
            }

            this.Tasks.set(existingTask.id, existingTask);
            return existingTask;
        }

        const newTask = this.createTaskObject(Task);

        if (this.Tasks.has(newTask.id)) {
            throw new Error(`Task with id ${newTask.id} already exists`);
        }

        this.Tasks.set(newTask.id, newTask);
        return newTask;
    }

    async get(id: string): Promise<CronTask | null> {
        return this.Tasks.get(id) || null
    }

    async getAll(): Promise<CronTask[]> {
        return Array.from(this.Tasks.values())
    }

    async update(id: string, updates: Partial<CronTask>): Promise<CronTask> {
        const Task = await this.get(id)
        if (!Task) {
            throw new Error(`Task with id ${id} not found`)
        }
        const updatedTask = this.updateTaskObject(Task, updates)
        this.Tasks.set(id, updatedTask)
        return updatedTask
    }

    async remove(id: string): Promise<boolean> {
        return this.Tasks.delete(id)
    }

    async clear(): Promise<void> {
        this.Tasks.clear()
    }
}


export function createMemoryStorage(): CronStorage {
    return new MemoryStorage()
}