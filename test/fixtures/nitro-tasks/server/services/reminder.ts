// server/services is not an auto-import directory, so this is reached via a
// relative import (../services/reminder) from the reminders task.
export function buildReminder(count: number) {
    return `${count} reminders pending`
}
