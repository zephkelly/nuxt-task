import { join } from 'pathe'
import { readdir } from 'fs/promises'

export type TaskFileInfo = {
    name: string
    path: string
    module: any
}


export function parseTaskName(relativePath: string): string {
    const normalizedPath = relativePath.replace(/\\/g, '/')
    
    const cleanPath = normalizedPath
        .replace(/^\/+|\/+$/g, '')
        .replace(/\/+/g, '/')
    
    const withoutExtension = cleanPath.replace(/\.[^/.]+$/, '')
    
    return withoutExtension.replace(/\//g, ':')
}

export async function scanTasksDirectory(baseDir: string) {
    const tasks: { name: string; path: string }[] = []
    
    async function scanDir(dir: string) {
        const files = await readdir(dir, { withFileTypes: true })
        
        for (const file of files) {
            const path = join(dir, file.name)
            
            if (file.isDirectory()) {
                await scanDir(path)
            } else if (file.isFile() && (file.name.endsWith('.ts') || file.name.endsWith('.js'))) {
                const relativePath = path.substring(baseDir.length + 1)
                const name = parseTaskName(relativePath)
                
                tasks.push({ name, path })
            }
        }
    }

    try {
        await scanDir(baseDir)
        return tasks
    }
    catch (error) {
        console.warn(`Failed to scan directory ${baseDir}:`, error)
        return []
    }
}