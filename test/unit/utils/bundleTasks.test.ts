import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { bundleTaskFile, bundleTaskFiles } from '../../../src/runtime/utils/bundleTasks';
import { join } from 'pathe';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';

describe('bundleTasks', () => {
    let tempDir: string;
    let tasksDir: string;

    beforeEach(async () => {
        // Create a temporary directory for test files
        tempDir = await mkdtemp(join(tmpdir(), 'nuxt-task-test-'));
        tasksDir = join(tempDir, 'tasks');
        await mkdir(tasksDir, { recursive: true });
    });

    afterEach(async () => {
        // Clean up temp directory
        if (tempDir) {
            await rm(tempDir, { recursive: true, force: true });
        }
    });

    describe('bundleTaskFile', () => {
        it('should bundle a simple task file without dependencies', { timeout: 30000 }, async () => {
            // Create a simple task file
            const taskPath = join(tasksDir, 'simple-task.ts');
            const taskContent = `
import { defineTaskHandler } from "nuxt-task/handler";

export default defineTaskHandler({
    meta: {
        name: "simple-task",
        description: "A simple test task",
    },
    schedule: "* * * * *",
    handler: async (ctx) => {
        return { message: "Hello from simple task" };
    },
});
            `;
            await writeFile(taskPath, taskContent, 'utf-8');

            // Bundle the task
            const bundledCode = await bundleTaskFile(taskPath, tasksDir);

            // Verify the bundle contains the task definition
            expect(bundledCode).toBeTruthy();
            expect(bundledCode).toContain('defineTaskHandler');
            expect(bundledCode).toContain('simple-task');
            expect(bundledCode).toContain('Hello from simple task');
        });

        it('should bundle a task file with relative imports', { timeout: 30000 }, async () => {
            // Create a services directory
            const servicesDir = join(tempDir, 'services');
            await mkdir(servicesDir, { recursive: true });

            // Create a service file that the task will import
            const servicePath = join(servicesDir, 'notification.ts');
            const serviceContent = `
export class NotificationService {
    static async sendNotification(userId: string) {
        return { sent: 1, failed: 0 };
    }
}
            `;
            await writeFile(servicePath, serviceContent, 'utf-8');

            // Create a task file that imports the service
            const taskPath = join(tasksDir, 'notification-task.ts');
            const taskContent = `
import { defineTaskHandler } from "nuxt-task/handler";
import { NotificationService } from "../services/notification";

export default defineTaskHandler({
    meta: {
        name: "notification-task",
        description: "Send notifications",
    },
    schedule: "* * * * *",
    handler: async (ctx) => {
        const result = await NotificationService.sendNotification("user123");
        return { sent: result.sent };
    },
});
            `;
            await writeFile(taskPath, taskContent, 'utf-8');

            // Bundle the task
            const bundledCode = await bundleTaskFile(taskPath, tasksDir);

            // Verify the bundle contains both the task and the imported service
            expect(bundledCode).toBeTruthy();
            expect(bundledCode).toContain('defineTaskHandler');
            expect(bundledCode).toContain('notification-task');
            expect(bundledCode).toContain('NotificationService');
            expect(bundledCode).toContain('sendNotification');
        });

        it('should bundle a task file with nested relative imports', { timeout: 30000 }, async () => {
            // Create nested directories
            const servicesDir = join(tempDir, 'services', 'notification');
            await mkdir(servicesDir, { recursive: true });

            // Create an index file
            const indexPath = join(servicesDir, 'index.ts');
            const indexContent = `
export class NotificationService {
    static async send(message: string) {
        return { success: true, message };
    }
}
            `;
            await writeFile(indexPath, indexContent, 'utf-8');

            // Create a task file with nested import
            const taskPath = join(tasksDir, 'deep-notification-task.ts');
            const taskContent = `
import { defineTaskHandler } from "nuxt-task/handler";
import { NotificationService } from "../services/notification/index";

export default defineTaskHandler({
    meta: {
        name: "deep-notification-task",
        description: "Deep import test",
    },
    schedule: "*/5 * * * *",
    handler: async (ctx) => {
        const result = await NotificationService.send("Test message");
        return result;
    },
});
            `;
            await writeFile(taskPath, taskContent, 'utf-8');

            // Bundle the task
            const bundledCode = await bundleTaskFile(taskPath, tasksDir);

            // Verify the bundle is valid
            expect(bundledCode).toBeTruthy();
            expect(bundledCode).toContain('defineTaskHandler');
            expect(bundledCode).toContain('NotificationService');
            expect(bundledCode).toContain('Test message');
        });

        it('should exclude external dependencies from the bundle', { timeout: 30000 }, async () => {
            // Create a task file that imports Nuxt/Nitro runtime
            const taskPath = join(tasksDir, 'external-deps-task.ts');
            const taskContent = `
import { defineTaskHandler } from "nuxt-task/handler";

export default defineTaskHandler({
    meta: {
        name: "external-deps-task",
        description: "Task with external deps",
    },
    schedule: "* * * * *",
    handler: async (ctx) => {
        return { message: "External deps task" };
    },
});
            `;
            await writeFile(taskPath, taskContent, 'utf-8');

            // Bundle the task
            const bundledCode = await bundleTaskFile(taskPath, tasksDir);

            // Verify the bundle doesn't inline nuxt-task/handler (it should be external)
            expect(bundledCode).toBeTruthy();
            // The import should still reference the external module
            expect(bundledCode).toMatch(/from\s+["']nuxt-task\/handler["']/);
        });
    });

    describe('bundleTaskFiles', () => {
        it('should bundle multiple task files', { timeout: 60000 }, async () => {
            // Create multiple task files
            const task1Path = join(tasksDir, 'task1.ts');
            const task1Content = `
import { defineTaskHandler } from "nuxt-task/handler";

export default defineTaskHandler({
    meta: {
        name: "task1",
        description: "First task",
    },
    schedule: "* * * * *",
    handler: async (ctx) => {
        return { message: "Task 1" };
    },
});
            `;
            await writeFile(task1Path, task1Content, 'utf-8');

            const task2Path = join(tasksDir, 'task2.ts');
            const task2Content = `
import { defineTaskHandler} from "nuxt-task/handler";

export default defineTaskHandler({
    meta: {
        name: "task2",
        description: "Second task",
    },
    schedule: "*/5 * * * *",
    handler: async (ctx) => {
        return { message: "Task 2" };
    },
});
            `;
            await writeFile(task2Path, task2Content, 'utf-8');

            // Bundle all tasks - pass RELATIVE paths
            const tasks = [
                { name: 'task1', path: 'task1.ts' },
                { name: 'task2', path: 'task2.ts' },
            ];
            const bundledTasks = await bundleTaskFiles(tasks, tasksDir);

            // Verify both tasks were bundled
            expect(bundledTasks).toHaveLength(2);
            expect(bundledTasks[0].name).toBe('task1');
            expect(bundledTasks[0].code).toContain('Task 1');
            expect(bundledTasks[1].name).toBe('task2');
            expect(bundledTasks[1].code).toContain('Task 2');
        });

        it('should skip tasks with invalid format', { timeout: 60000 }, async () => {
            // Create a valid task
            const validTaskPath = join(tasksDir, 'valid-task.ts');
            const validTaskContent = `
import { defineTaskHandler } from "nuxt-task/handler";

export default defineTaskHandler({
    meta: {
        name: "valid-task",
        description: "Valid task",
    },
    schedule: "* * * * *",
    handler: async (ctx) => {
        return { message: "Valid" };
    },
});
            `;
            await writeFile(validTaskPath, validTaskContent, 'utf-8');

            // Create an invalid task (missing meta)
            const invalidTaskPath = join(tasksDir, 'invalid-task.ts');
            const invalidTaskContent = `
export default {
    someProperty: "value"
};
            `;
            await writeFile(invalidTaskPath, invalidTaskContent, 'utf-8');

            // Bundle all tasks - pass RELATIVE paths
            const tasks = [
                { name: 'valid-task', path: 'valid-task.ts' },
                { name: 'invalid-task', path: 'invalid-task.ts' },
            ];
            const bundledTasks = await bundleTaskFiles(tasks, tasksDir);

            // Only the valid task should be bundled
            expect(bundledTasks).toHaveLength(1);
            expect(bundledTasks[0].name).toBe('valid-task');
        });

        it('should preserve task metadata in bundled result', { timeout: 60000 }, async () => {
            // Create a task
            const taskPath = join(tasksDir, 'metadata-task.ts');
            const taskContent = `
import { defineTaskHandler } from "nuxt-task/handler";

export default defineTaskHandler({
    meta: {
        name: "metadata-task",
        description: "Task with metadata",
    },
    schedule: "*/15 * * * *",
    handler: async (ctx) => {
        return { message: "Metadata task" };
    },
});
            `;
            await writeFile(taskPath, taskContent, 'utf-8');

            // Bundle the task - pass RELATIVE path
            const tasks = [{ name: 'metadata-task', path: 'metadata-task.ts' }];
            const bundledTasks = await bundleTaskFiles(tasks, tasksDir);

            // Verify metadata is preserved
            expect(bundledTasks).toHaveLength(1);
            expect(bundledTasks[0].module.default.meta.name).toBe('metadata-task');
            expect(bundledTasks[0].module.default.meta.description).toBe('Task with metadata');
            expect(bundledTasks[0].module.default.schedule).toBe('*/15 * * * *');
        });
    });
});
