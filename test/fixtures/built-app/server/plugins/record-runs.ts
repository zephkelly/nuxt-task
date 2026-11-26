export interface RecordedEvent {
    hook: string
    name: string
    metaName: string | undefined
    trigger: string
    status: string
}

export const recorded: RecordedEvent[] = []

export default defineNitroPlugin((nitroApp) => {
    for (const hook of ['task:run:start', 'task:run:finish'] as const) {
        nitroApp.hooks.hook(hook, ({ run }) => {
            recorded.push({
                hook,
                name: run.name,
                metaName: run.metaName,
                trigger: run.trigger,
                status: run.status,
            })
        })
    }
})
