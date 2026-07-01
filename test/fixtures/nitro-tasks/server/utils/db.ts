// Auto-imported from server/utils, and also imported via the `~/server/utils/db`
// alias from the reminders task to prove aliased imports resolve in native mode.
export function getPg() {
    return {
        async query(_sql: string) {
            return [{ id: 1 }, { id: 2 }, { id: 3 }]
        },
    }
}
