export default defineEventHandler(async () => {
    try {
        const result = await triggerTask('reports:weekly', { triggeredBy: 'test' })
        return { ok: true, result }
    } catch (error: any) {
        return { ok: false, error: error?.name ?? String(error), message: error?.message }
    }
})
