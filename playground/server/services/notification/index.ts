// server/services is NOT an auto-import directory, so this is reached via a
// relative import from the task file (../services/notification).
export function sendNotification(message: string) {
    console.log(`[notification] ${message}`)
    return { sent: true, message }
}
