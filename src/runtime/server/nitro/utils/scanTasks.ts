import { join } from 'pathe'
import { readdir } from 'fs/promises'



export function parseTaskName(relativePath: string): string {
    // Normalize path separators to forward slashes
    const normalizedPath = relativePath.replace(/\\/g, '/')
    
    // Remove leading, trailing slashes and collapse multiple slashes
    const cleanPath = normalizedPath
        .replace(/^\/+|\/+$/g, '')     // Remove leading/trailing slashes
        .replace(/\/+/g, '/')          // Collapse multiple slashes to single
    
    // Remove file extension
    const withoutExtension = cleanPath.replace(/\.[^/.]+$/, '')
    
    // Convert slashes to colons
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
                // Get the relative path from the base directory
                const relativePath = path.substring(baseDir.length + 1)
                const name = parseTaskName(relativePath)
                
                tasks.push({ name, path })
            }
        }
    }

    try {
        await scanDir(baseDir)
        return tasks
    } catch (error) {
        console.warn(`Failed to scan directory ${baseDir}:`, error)
        return []
    }
}