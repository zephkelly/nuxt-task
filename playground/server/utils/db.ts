// Lives in server/utils, so Nitro auto-imports getPg() everywhere on the
// server. It is also imported explicitly via the `~/server/utils/db` alias
// from a task file to prove aliased imports resolve.
export function getPg() {
    return {
        async query(_sql: string) {
            return [{ id: 1 }, { id: 2 }]
        },
    }
}
