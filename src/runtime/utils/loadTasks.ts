export type TaskModule = {
    name: string;
    path: string;
    module: {
        default: {
            meta: {
                description?: string;
            };
            schedule?: string;
        };
    };
}

export async function loadTaskModule(task: { name: string; path: string }, tasksDir: string): Promise<TaskModule | null> {
    try {
        const relativePath = task.path.substring(tasksDir.length + 1)
        const modulePath = relativePath.replace(/\.[^/.]+$/, '')
        const taskModule = await import(task.path)
    
        if (!taskModule?.default?.meta) {
            console.warn(`Task ${task.name} has invalid format - missing meta`)
            return null
        }
    
        return {
            name: task.name,
            path: modulePath,
            module: taskModule
        }
    }
    catch (error) {
        console.warn(`Failed to load task ${task.name}:`, error)
        return null
    }
}
  
export async function loadTaskModules(tasks: Array<{ name: string; path: string }>, tasksDir: string) {
    const loadedModules: TaskModule[] = []
    
    for (const task of tasks) {
        const loadedModule = await loadTaskModule(task, tasksDir)
        if (loadedModule) {
            loadedModules.push(loadedModule)
        }
    }
  
    return loadedModules
}