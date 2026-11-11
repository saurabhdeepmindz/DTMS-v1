import { CronExpressionParser } from 'cron-parser';
import { validateJob } from './validation.ts';
import type { CronDefinition, JobDriver, StoredSchedule } from './types.ts';

export function validateCron(definition: CronDefinition, options: { hosted?: boolean } = {}): CronDefinition {
    if (definition.inputs === null) {
        throw new Error('Cron inputs must be a JSON object');
    }

    const validated = validateJob(definition, options);
    for (const key of definition.requiredParameters || []) {
        if (definition.inputs?.[key] == null) {
            throw new Error(`Missing required Scheduled Task parameter: ${key}`);
        }
    }

    if (!definition.id || definition.id.length > 255) {
        throw new Error('A cron trigger ID is required');
    }

    if (typeof definition.cron !== 'string' || definition.cron.trim().split(/\s+/).length !== 5) {
        throw new Error('Use a five-field cron expression (minute, hour, day, month, weekday)');
    }

    if (/[H#?]/.test(definition.cron)) {
        throw new Error('Randomized, question-mark and nth-weekday cron syntax is not supported');
    }

    const timezone = definition.timezone || 'UTC';
    if (
        definition.startsAt !== undefined &&
        (typeof definition.startsAt !== 'string' ||
            !/(Z|[+-]\d{2}:\d{2})$/.test(definition.startsAt) ||
            !Number.isFinite(Date.parse(definition.startsAt)))
    ) {
        throw new Error('Schedule start date must be an ISO date with a timezone');
    }
    new Intl.DateTimeFormat('en', { timeZone: timezone }).format();
    const parsed = CronExpressionParser.parse(definition.cron, { tz: timezone });
    if (parsed.fields.dayOfWeek.values.some(value => typeof value !== 'number')) {
        throw new Error('Use weekday numbers or names, without "L"');
    }

    if (
        definition.backfillHours !== undefined &&
        (!Number.isInteger(definition.backfillHours) || definition.backfillHours < 0 || definition.backfillHours > 8760)
    ) {
        throw new Error('Backfill must be between 0 and 8760 hours');
    }

    if (definition.overlap && !['allow', 'queue', 'skip'].includes(definition.overlap)) {
        throw new Error('Invalid cron overlap policy');
    }

    return { ...definition, inputs: validated.inputs, timezone };
}

function localParts(at: number, timezone: string) {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
    }).formatToParts(at);
    const values = Object.fromEntries(
        parts.filter(part => part.type !== 'literal').map(part => [part.type, part.value])
    );
    const localEpoch = Date.UTC(
        +values.year,
        +values.month - 1,
        +values.day,
        +values.hour,
        +values.minute,
        +values.second
    );

    return {
        hour: +values.hour,
        minute: +values.minute,
        localEpoch,
        offset: localEpoch - Math.floor(at / 1000) * 1000,
    };
}

function isSecondLocalOccurrence(at: number, timezone: string): boolean {
    if (timezone === 'UTC') {
        return false;
    }

    const current = localParts(at, timezone);
    const earlierOffset = localParts(at - 86400000, timezone).offset;
    const overlap = earlierOffset - current.offset;

    return overlap > 0 && localParts(at - overlap, timezone).localEpoch === current.localEpoch;
}

export function occurrencePage(schedule: StoredSchedule, through = new Date(), limit = 100) {
    const definition = validateCron(schedule.definition);
    const end = Math.min(through.getTime(), schedule.ends_at ? Date.parse(schedule.ends_at) : Infinity);
    const start = Math.max(
        Date.parse(schedule.cursor_at),
        Date.parse(schedule.active_since),
        // The start date is inclusive; activation and the recovery cursor remain exclusive.
        definition.startsAt ? Date.parse(definition.startsAt) - 1 : -Infinity,
        through.getTime() - Math.max(60000, (definition.backfillHours ?? 24) * 3600000)
    );
    const occurrences: { at: string }[] = [];
    // SQL boundaries can contain microseconds. Date is only used to calculate minute occurrences;
    // preserve the original boundary when committing the retired revision's final cursor.
    const endCursor =
        schedule.ends_at && Date.parse(schedule.ends_at) <= through.getTime()
            ? schedule.ends_at
            : through.toISOString();
    if (start >= end) {
        return { occurrences, through: endCursor };
    }

    const iterator = CronExpressionParser.parse(definition.cron, {
        // cron-parser carries cursor milliseconds into its end-date check, before resetting them.
        // Five-field cron occurrences have zero milliseconds; preserve the exclusive second boundary.
        currentDate: Math.floor(start / 1000) * 1000,
        endDate: end,
        tz: definition.timezone,
    });
    let cursor = end;
    while (iterator.hasNext()) {
        const next = iterator.next().getTime();
        const local = localParts(next, definition.timezone!);
        // cron-parser can shift a nonexistent clock time forward; the product skips it.
        if (
            !iterator.fields.hour.values.some(value => value === local.hour) ||
            !iterator.fields.minute.values.some(value => value === local.minute)
        ) {
            continue;
        }

        if (isSecondLocalOccurrence(next, definition.timezone!)) {
            continue;
        }

        occurrences.push({ at: new Date(next).toISOString() });
        if (occurrences.length >= limit) {
            cursor = next;
            break;
        }
    }

    return { occurrences, through: cursor === end ? endCursor : new Date(cursor).toISOString() };
}

/** Keep the definitions this runtime can honor. A rejected one is reported, never thrown. */
export function usableCrons(
    definitions: CronDefinition[],
    onInvalid?: (definition: CronDefinition, error: unknown) => void
): CronDefinition[] {
    return definitions.filter(definition => {
        try {
            validateCron(definition);
            return true;
        } catch (error) {
            onInvalid?.(definition, error);
            return false;
        }
    });
}

export async function materializeCrons(
    driver: JobDriver,
    now = new Date(),
    revision?: string,
    onInvalid?: (schedule: StoredSchedule, error: unknown) => void
) {
    let remaining = false;
    const blocked = new Set<string>();
    for (const schedule of await driver.schedules()) {
        // A worker clock earlier than the SQL activation cursor must not move it backwards.
        const cursor = Date.parse(schedule.cursor_at);
        if (cursor >= now.getTime()) {
            continue;
        }
        if (blocked.has(schedule.definition.id)) {
            continue;
        }

        let page: ReturnType<typeof occurrencePage>;
        try {
            page = occurrencePage(schedule, now);
        } catch (error) {
            // One definition the runtime cannot honor must not stop the other schedules, nor the drain.
            blocked.add(schedule.definition.id);
            onInvalid?.(schedule, error);
            continue;
        }

        await driver.materialize(schedule.id, schedule.cursor_at, page.through, page.occurrences, revision);
        if (
            Date.parse(page.through) <
            Math.min(now.getTime(), schedule.ends_at ? Date.parse(schedule.ends_at) : Infinity)
        ) {
            remaining = true;
            blocked.add(schedule.definition.id);
        }
    }

    return remaining;
}

/** AWS requires '?' on either calendar-day or weekday; POSIX matching of both is OR. */
export function schedulerExpressions(definition: CronDefinition): string[] {
    validateCron(definition);
    const [minute, hour, day, month, weekday] = definition.cron.trim().split(/\s+/);
    const parsed = CronExpressionParser.parse(definition.cron);
    const names = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
    const days = [...new Set(parsed.fields.dayOfWeek.values.map(value => names[(value as number) % 7]))].join(',');
    if (weekday === '*') {
        return [`cron(${minute} ${hour} ${day} ${month} ? *)`];
    }

    const weekly = `cron(${minute} ${hour} ? ${month} ${days} *)`;
    if (day === '*') {
        return [weekly];
    }

    return [`cron(${minute} ${hour} ${day} ${month} ? *)`, weekly];
}
