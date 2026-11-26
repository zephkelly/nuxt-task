import TimezoneUtils from "../utils/timezone";
import type { ParsedExpression } from "../expression";

/**
 * How far ahead a next-run search will look before declaring an expression
 * unsatisfiable.
 *
 * Deliberately generous: February 29th on a given weekday recurs on a 28-year
 * cycle, so a tight bound would reject legal expressions. The search skips
 * whole days and hours it cannot match, so a wide horizon costs thousands of
 * iterations rather than millions.
 */
export const MAX_NEXT_RUN_HORIZON_YEARS = 50;

/**
 * Raised when a cron expression has no next run time within the search
 * horizon, i.e. it can never fire (`0 0 30 2 *` — February 30th).
 */
export class UnsatisfiableCronExpressionError extends Error {
    constructor(expression: string, years: number) {
        super(
            `Cron expression "${expression}" has no next run time within `
            + `${years} years, so it can never run.`
        );
        this.name = "UnsatisfiableCronExpressionError";
    }
}

/**
 * Calculates the first occurrence of a parsed expression strictly after
 * `from`, using the custom scheduler's own matching rules (day-of-month and
 * day-of-week are ANDed, minute resolution).
 *
 * Lives outside the Scheduler so `nextRun()` can answer for any reference
 * time without a scheduler instance.
 *
 * @param {ParsedExpression} parsed - The parsed cron expression
 * @param {string} expression - The source expression, for error messages
 * @param {Date} from - The reference time; the result is strictly after it
 * @returns {Date} The next valid run time
 * @throws {UnsatisfiableCronExpressionError} If nothing matches within the horizon
 */
export function computeNextRunTime(
    parsed: ParsedExpression,
    expression: string = "unknown",
    from: Date = new Date()
): Date {
    const now = from;

    const tzNow = TimezoneUtils.convertTimezone(
        now,
        "UTC",
        parsed.timezone
    );

    if (typeof tzNow === "string") {
        throw new TypeError(
            "Unexpected string return from timezone conversion"
        );
    }

    const candidate = new Date(tzNow.toJSDate());

    candidate.setSeconds(0);
    candidate.setMilliseconds(0);

    candidate.setMinutes(candidate.getMinutes() + 1);

    const hourFormatter = new Intl.DateTimeFormat("en-US", {
        timeZone: parsed.timezone,
        hour: "numeric",
        hour12: false,
    });

    const minuteFormatter = new Intl.DateTimeFormat("en-US", {
        timeZone: parsed.timezone,
        minute: "numeric",
    });

    const monthFormatter = new Intl.DateTimeFormat("en-US", {
        timeZone: parsed.timezone,
        month: "numeric",
    });

    const dayFormatter = new Intl.DateTimeFormat("en-US", {
        timeZone: parsed.timezone,
        day: "numeric",
    });

    const weekdayFormatter = new Intl.DateTimeFormat("en-US", {
        timeZone: parsed.timezone,
        weekday: "long",
    });

    const weekdayMap: Record<string, number> = {
        Sunday: 0,
        Monday: 1,
        Tuesday: 2,
        Wednesday: 3,
        Thursday: 4,
        Friday: 5,
        Saturday: 6,
    };

    // Bound the search. An expression that can never match used to spin
    // this loop forever, and because it is synchronous that wedged the
    // whole process rather than just stalling one task.
    const horizon = new Date(candidate.getTime());
    horizon.setFullYear(
        horizon.getFullYear() + MAX_NEXT_RUN_HORIZON_YEARS
    );

    while (candidate <= horizon) {
        // ICU reports midnight as hour 24 in some builds, and cron hours
        // are 0-23, so normalise before matching or arithmetic.
        const hour =
            Number.parseInt(hourFormatter.format(candidate)) % 24;
        const minute = Number.parseInt(minuteFormatter.format(candidate));
        const month = Number.parseInt(monthFormatter.format(candidate));
        const dayOfMonth = Number.parseInt(dayFormatter.format(candidate));
        const dayOfWeek = weekdayMap[weekdayFormatter.format(candidate)];

        // Skip coarsely. Advancing a minute at a time makes a distant
        // match unreachable in practice: a leap-day expression can be
        // decades out, which is millions of iterations. The step sizes are
        // derived from the clock reading in the task's own timezone and
        // always land at or before the next boundary, so a valid slot can
        // never be stepped over.
        if (
            !parsed.month.includes(month) ||
            !parsed.dayOfMonth.includes(dayOfMonth) ||
            !parsed.dayOfWeek.includes(dayOfWeek)
        ) {
            const minutesUntilNextDay = Math.max(
                1,
                (23 - hour) * 60 + (60 - minute)
            );
            candidate.setMinutes(
                candidate.getMinutes() + minutesUntilNextDay
            );
            continue;
        }

        if (!parsed.hour.includes(hour)) {
            const minutesUntilNextHour = Math.max(1, 60 - minute);
            candidate.setMinutes(
                candidate.getMinutes() + minutesUntilNextHour
            );
            continue;
        }

        if (
            parsed.minute.includes(minute) &&
            candidate > tzNow.toJSDate()
        ) {
            const convertedTimezone = TimezoneUtils.convertTimezone(
                candidate,
                parsed.timezone,
                "UTC"
            );

            return TimezoneUtils.toJSDate(convertedTimezone);
        }

        candidate.setMinutes(candidate.getMinutes() + 1);
    }

    throw new UnsatisfiableCronExpressionError(
        expression,
        MAX_NEXT_RUN_HORIZON_YEARS
    );
}
