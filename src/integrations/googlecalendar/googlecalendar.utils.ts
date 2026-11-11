import { GoogleAuth } from 'google-auth-library';
import { calendar, type calendar_v3 } from '@googleapis/calendar';

function getCredentialsObject(clientEmail: string, privateKey: string) {
    return {
        type: 'service_account',
        client_email: clientEmail,
        private_key: privateKey?.replace(/\\n/g, '\n'),
        auth_uri: 'https://accounts.google.com/o/oauth2/auth',
        token_uri: 'https://oauth2.googleapis.com/token',
        auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
        universe_domain: 'googleapis.com',
    };
}

export function getCalendarClient(connection: ConnectionConfig) {
    if (!connection?.clientEmail || !connection?.privateKey) {
        throw new Error(
            'Google Calendar connection is missing or incomplete (no client email / private key) — check the connectionId and the connection configuration.'
        );
    }

    const googleAuth = new GoogleAuth({
        credentials: getCredentialsObject(connection.clientEmail, connection.privateKey),
        scopes: ['https://www.googleapis.com/auth/calendar'],
    });

    return calendar({ version: 'v3', auth: googleAuth });
}

// Google caps a single events.list page at 250 items; the requested total is honored by
// paginating with pageToken (the old integration's hard 50-result ceiling was a missing
// pagination loop — WW-4726).
export const EVENTS_PAGE_MAX = 250;

// A bound on/off does not always arrive as a boolean: a select wired to the field sends the
// STRING "false", which is truthy — the same slip that sorted a GA4 report descending on
// "Fewest first" (WW-5910 QA G-04). With allDay bindable since C-27, "false" would have read
// as an all-day event. Only `true` and "true" mean yes.
export function toBoolean(value: unknown): boolean {
    return value === true || (typeof value === 'string' && value.trim().toLowerCase() === 'true');
}

// Page sizes reach the view as strings; `Math.min("abc", 250)` is NaN and Google rejects it
// with a bare badRequest. Name the field instead. Empty means "not set" (undefined).
export function toWholeNumber(value: unknown, field: string, { min = 0 }: { min?: number } = {}): number | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    const numeric = typeof value === 'number' ? value : Number(String(value).trim());
    if (!Number.isInteger(numeric) || numeric < min || String(value).trim() === '') {
        throw new Error(
            `"${field}" must be a whole number${min > 0 ? ` of at least ${min}` : ''}, but received ${JSON.stringify(value)}.`
        );
    }
    return numeric;
}

// The platform's error middleware flattens an unhandled provider error into a detail-less
// 500 (WW-5994 QA C-11, and the same finding against weweb-back's controllers). Pull out
// Google's own message so a caller-side mistake reads as one. Returns undefined for anything
// that is not a Google 4xx — those stay genuine server errors and propagate untouched.
export function describeGoogleError(error: any): string | undefined {
    const status = error?.code ?? error?.response?.status;
    const message = error?.errors?.[0]?.message ?? error?.response?.data?.error?.message ?? error?.message;
    if (typeof status === 'number' && status >= 400 && status < 500 && message) return message;
    return undefined;
}

// Google answers a bare `badRequest` with no actionable message whenever a value has the
// wrong shape — a date in a datetime field, a datetime in a date field, an offset-less
// datetime with no time zone (WW-5994 QA C-01 / C-10). Check the shape here instead, and
// name the field, the expected format and what actually arrived.
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})?$/;

function isRealCalendarDate(datePart: string): boolean {
    const [year, month, day] = datePart.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

// The hints differ by field: start/end sit next to the "All-day event" toggle and a Time
// Zone select, the List Events window has neither — pointing a user at a control the form
// does not show is worse than no hint at all.
const EVENT_TIME_HINTS = {
    shape: 'Turn "All-day event" on if you meant a whole-day date like 2026-09-23.',
    offset: 'Either add an offset (e.g. 2026-09-23T10:00:00Z or 2026-09-23T10:00:00+02:00), or set "Time Zone" so the time is read in that zone.',
};
const TIME_FILTER_HINTS = {
    shape: 'This filter needs a full timestamp, not a plain date — use 2026-10-06T00:00:00Z for the start of that day.',
    offset: 'Add an offset, e.g. 2026-10-06T00:00:00Z or 2026-10-06T00:00:00+02:00.',
};

export function assertDateOnly(value: unknown, field: string): string {
    if (typeof value === 'string' && DATE_ONLY_PATTERN.test(value) && isRealCalendarDate(value)) return value;
    throw new Error(
        `"${field}" must be a date in YYYY-MM-DD format for an all-day event (e.g. 2026-09-23), but received ${JSON.stringify(value)}. ` +
            'Turn "All-day event" off to use a date and time instead.'
    );
}

// `requireOffset` mirrors Google's own rule: a datetime may omit its offset only when a time
// zone travels with it (start/end + timeZone); timeMin/timeMax always need one.
export function assertRfc3339(
    value: unknown,
    field: string,
    { requireOffset = false, hints = EVENT_TIME_HINTS }: { requireOffset?: boolean; hints?: { shape: string; offset: string } } = {}
): string {
    if (typeof value === 'string') {
        const match = DATETIME_PATTERN.exec(value);
        if (match && isRealCalendarDate(value.slice(0, 10))) {
            if (match[1] || !requireOffset) return value;
            throw new Error(`"${field}" is missing its time zone: ${JSON.stringify(value)}. ${hints.offset}`);
        }
    }
    throw new Error(
        `"${field}" must be an RFC3339 date and time (e.g. 2026-09-23T10:00:00Z), but received ${JSON.stringify(value)}. ${hints.shape}`
    );
}

// events.list rejects timeMin/timeMax without an offset, and reports it as a bare
// `badRequest` with no message (WW-5994 QA C-10).
export function assertTimeFilter(value: unknown, field: string): string {
    return assertRfc3339(value, field, { requireOffset: true, hints: TIME_FILTER_HINTS });
}

// A service account's `primary` calendar is its OWN calendar, which no human can open. Google
// accepts the write and answers 200, so the workflow looks successful and the event is invisible
// forever (WW-5994 QA C-14). Refusing the alias costs no capability: that same calendar is still
// reachable by its real id (the service account's email address), so this rejects an ambiguous
// word, not a feature.
export function assertUsableCalendarId(value: unknown): string {
    if (typeof value === 'string' && value.trim().toLowerCase() === 'primary') {
        throw new Error(
            '"calendarId" cannot be "primary". For a service account that is its own private calendar, which nobody can open — anything written there is invisible. ' +
                'Pick a calendar from calendars-list, or pass its ID (c_abc123@group.calendar.google.com, or a user email for a personal calendar).'
        );
    }
    if (typeof value !== 'string' || value.trim() === '') {
        throw new Error(
            `"calendarId" is required — pass a calendar ID from calendars-list, but received ${JSON.stringify(value)}.`
        );
    }
    return value;
}

// Update sends only what "Fields to update" names (`_fields`). A named field is set to the
// value given, or CLEARED when none is — the only way a value can be removed, because the
// editor form drops an emptied input before it is saved (WW-5994 QA C-15). No list at all
// (older workflows, a minimal AI call) keeps the previous contract: non-empty values are
// sent and everything else is left alone, so nothing is ever wiped by omission.
const UPDATABLE_FIELDS = [
    'summary',
    'description',
    'location',
    'attendees',
    'recurrence',
    'reminders',
    'colorId',
    'visibility',
    'transparency',
] as const;
type UpdatableField = (typeof UPDATABLE_FIELDS)[number];
// The slice of the patch body these fields produce — typed so the handler's events.patch call
// keeps Google's own schema (string | null, string[] | null, …) end to end.
type UpdatePatchFields = Pick<calendar_v3.Schema$Event, UpdatableField>;
// The start/end/allDay/timeZone group is one selectable entry: coupled, and never cleared.
export const TIME_FIELDS_ENTRY = 'time';
const SELECTABLE_FIELDS: readonly string[] = [...UPDATABLE_FIELDS, TIME_FIELDS_ENTRY];

// What Google reads as "no value" for each field. Title has no such state on purpose.
const CLEARED_VALUES: Omit<Required<UpdatePatchFields>, 'summary'> = {
    description: null,
    location: null,
    attendees: [],
    recurrence: [],
    reminders: { useDefault: true },
    visibility: 'default',
    transparency: 'opaque',
    colorId: null,
};

export function resolveFieldsToUpdate(value: unknown): Set<string> {
    const fields = new Set<string>();
    if (value === undefined || value === null || value === '') return fields;
    for (const entry of Array.isArray(value) ? value : [value]) {
        if (typeof entry !== 'string' || entry.trim() === '') continue;
        const field = entry.trim();
        if (!SELECTABLE_FIELDS.includes(field)) {
            throw new Error(
                `"_fields" cannot update ${JSON.stringify(field)}. Updatable fields: ${SELECTABLE_FIELDS.join(', ')}.`
            );
        }
        fields.add(field);
    }
    return fields;
}

// True when the time block (start/end/allDay/timeZone) may be read: always without a list,
// otherwise only when "time" is picked.
export function isTimeUpdateRequested(selected: Set<string>): boolean {
    return selected.size === 0 || selected.has(TIME_FIELDS_ENTRY);
}

export function buildUpdatePatchFields(
    args: Record<string, any>,
    selected: Set<string> = resolveFieldsToUpdate(args._fields)
): UpdatePatchFields {
    const given: UpdatePatchFields = {
        summary: args.summary || undefined,
        description: args.description || undefined,
        location: args.location || undefined,
        attendees: args.attendees?.length ? args.attendees : undefined,
        recurrence: normalizeRecurrence(args.recurrence),
        reminders: buildReminders(args.reminders, args.reminderOverrides),
        colorId: args.colorId || undefined,
        visibility: args.visibility || undefined,
        transparency: args.transparency || undefined,
    };

    if (selected.size === 0) return given;

    const patch: UpdatePatchFields = {};
    for (const field of UPDATABLE_FIELDS) {
        if (!selected.has(field)) continue;
        if (given[field] !== undefined) {
            (patch as Record<string, unknown>)[field] = given[field];
        } else if (field === 'summary') {
            throw new Error(
                '"Title" is listed in "Fields to update" but is empty — give it a value, or remove it from the list to keep the current title.'
            );
        } else {
            (patch as Record<string, unknown>)[field] = CLEARED_VALUES[field];
        }
    }
    return patch;
}

// Google accepts a whitespace-only summary and creates an event titled " " (WW-5994 battery
// case 3, and QA C-05 for the update path). An empty string keeps patch semantics — "leave
// this field alone" — but a string the user actually typed spaces into is a mistake.
export function assertSummary(value: unknown, { required }: { required: boolean }): void {
    if (value === undefined || value === null || value === '') {
        if (required) throw new Error('Event title (summary) is required — provide a non-empty title.');
        return;
    }
    if (typeof value !== 'string') {
        throw new Error(`Event title (summary) must be text, but received ${JSON.stringify(value)}.`);
    }
    if (value.trim() === '') {
        throw new Error(
            `Event title (summary) cannot be only spaces — received ${JSON.stringify(value)}. ` +
                (required
                    ? 'Provide a real title.'
                    : 'Provide a real title, or leave the field empty to keep the current one.')
        );
    }
}

// Changing an event's time zone keeps the wall clock and moves the instant — the meaning it
// has in Google Calendar's own UI. Getting that wall clock right is subtler than it looks:
// Google renders start.dateTime with the offset of the CALENDAR's zone, not of the zone the
// event is declared in, so an event defined as 10:00 Asia/Tokyo comes back as
// 2026-10-22T03:00:00+02:00 on a Europe/Paris calendar. Slicing the offset off that string
// would "preserve" 03:00 — a time nobody chose (caught live, WW-5994 QA C-06). Read the
// instant back in the event's own zone instead.
export function toWallClock(dateTime: string, timeZone?: string): string {
    if (!timeZone) return dateTime.slice(0, 19);
    const instant = new Date(dateTime);
    if (Number.isNaN(instant.getTime())) return dateTime.slice(0, 19);
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    })
        .formatToParts(instant)
        .reduce<Record<string, string>>((acc, part) => {
            acc[part.type] = part.value;
            return acc;
        }, {});
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}

// All-day end dates are EXCLUSIVE: a one-day event on 2026-09-23 ends 2026-09-24. Booking
// forms naturally send the same date twice and Google accepts it as a zero-length event
// (WW-5994 QA C-28) — reject it and name the date that was meant.
export function assertAllDayRange(start: string | undefined, end: string | undefined) {
    if (!start || !end || end > start) return;
    const dayAfterStart = new Date(`${start}T00:00:00Z`);
    dayAfterStart.setUTCDate(dayAfterStart.getUTCDate() + 1);
    const suggestion = dayAfterStart.toISOString().slice(0, 10);
    throw new Error(
        `"end" (${end}) must be after "start" (${start}) — an all-day event's end date is EXCLUSIVE. ` +
            `For a one-day event on ${start}, set "end" to ${suggestion}.`
    );
}

// Timed events carry {dateTime, timeZone}, all-day events carry {date} — the two are
// mutually exclusive in the Google API. The form exposes flat keys (start, end, allDay,
// timeZone) so the timeZone can never be silently dropped (WW-4726: "time zone not working").
//
// `forPatch` nulls the key the other shape uses: events.patch MERGES, so sending {date} onto
// an event that already has {dateTime} leaves both set and Google rejects it as "Invalid
// start time" (WW-5994 QA C-04). Only the all-day branch nulls timeZone — a timed patch that
// omits it must leave the event's existing zone alone.
export function buildEventTime(
    value: string,
    allDay: boolean | undefined,
    timeZone: string | undefined,
    { field, forPatch = false }: { field: string; forPatch?: boolean }
) {
    if (allDay) {
        return { date: assertDateOnly(value, field), ...(forPatch ? { dateTime: null, timeZone: null } : {}) };
    }
    return {
        dateTime: assertRfc3339(value, field, { requireOffset: !timeZone }),
        ...(timeZone ? { timeZone } : {}),
        ...(forPatch ? { date: null } : {}),
    };
}

// The editor recurrence field is a preset select emitting ONE RRULE string ('' = does not
// repeat); bindings may still supply an array of RFC 5545 lines. Normalize both shapes to
// what Google expects and drop null/empty entries — the old array widget could emit [null],
// which used to be forwarded as-is. Empty result → undefined (recurrence omitted).
export function normalizeRecurrence(value: unknown): string[] | undefined {
    const lines = (Array.isArray(value) ? value : [value]).filter(
        (line): line is string => typeof line === 'string' && line.trim() !== ''
    );
    return lines.length ? lines : undefined;
}

// Google has three reminder states and the old on/off could only express two of them, with
// both of its positions producing the same event (WW-5994 QA C-07). The `reminders` select
// names them: omitted = the calendar's defaults (send nothing at all), 'custom' = the
// overrides, 'none' = useDefault false with an empty list, which silences the event.
export function buildReminders(reminders: unknown, reminderOverrides: { method: string; minutes: number }[] | undefined) {
    if (reminders === 'none') return { useDefault: false, overrides: [] };
    if (reminders === 'custom') return { useDefault: false, overrides: reminderOverrides ?? [] };
    if (reminders === undefined || reminders === null || reminders === '') {
        // Overrides with no mode set still mean "use these" — an AI or a binding can fill the
        // list without touching the select, and dropping them silently would be the old bug.
        return reminderOverrides?.length ? { useDefault: false, overrides: reminderOverrides } : undefined;
    }
    throw new Error(
        `"reminders" must be "custom" or "none", but received ${JSON.stringify(reminders)}. ` +
            "Omit it to keep the calendar's default reminders."
    );
}
