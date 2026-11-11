import {
    getCalendarClient,
    buildEventTime,
    buildReminders,
    normalizeRecurrence,
    assertTimeFilter,
    assertAllDayRange,
    assertSummary,
    assertUsableCalendarId,
    buildUpdatePatchFields,
    isTimeUpdateRequested,
    resolveFieldsToUpdate,
    toWallClock,
    toBoolean,
    toWholeNumber,
    EVENTS_PAGE_MAX,
} from './googlecalendar.utils.ts';

global.registerAction('googlecalendar/events-list', async ({ args = {} }: ActionParams, context: ActionContext) => {
    assertUsableCalendarId(args.calendarId);
    // A plain date like 2026-10-06 is the common mistake here (WW-5994 QA C-10).
    if (args.timeMin) assertTimeFilter(args.timeMin, 'timeMin');
    if (args.timeMax) assertTimeFilter(args.timeMax, 'timeMax');
    if (args.updatedMin) assertTimeFilter(args.updatedMin, 'updatedMin');

    const calendar = getCalendarClient(context.connection);

    // Strict booleans: a bound "false" is a string, and strings are truthy.
    const singleEvents = args.singleEvents === undefined || args.singleEvents === null || args.singleEvents === '' ? true : toBoolean(args.singleEvents);
    const maxResults = toWholeNumber(args.maxResults, 'maxResults', { min: 1 }) ?? EVENTS_PAGE_MAX;

    const events = [];
    let pageToken: string | undefined;
    do {
        const response = await calendar.events.list({
            calendarId: args.calendarId,
            timeMin: args.timeMin || undefined,
            timeMax: args.timeMax || undefined,
            updatedMin: args.updatedMin || undefined,
            q: args.q || undefined,
            singleEvents,
            orderBy: args.orderBy || undefined,
            showDeleted: toBoolean(args.showDeleted) || undefined,
            timeZone: args.timeZone || undefined,
            eventTypes: args.eventTypes?.length ? args.eventTypes : undefined,
            maxResults: Math.min(maxResults - events.length, EVENTS_PAGE_MAX),
            pageToken,
        });
        events.push(...(response.data.items ?? []));
        pageToken = response.data.nextPageToken ?? undefined;
    } while (pageToken && events.length < maxResults);

    return { events, count: events.length };
});

global.registerAction('googlecalendar/events-get', async ({ args = {} }: ActionParams, context: ActionContext) => {
    assertUsableCalendarId(args.calendarId);

    const calendar = getCalendarClient(context.connection);

    const response = await calendar.events.get({
        calendarId: args.calendarId,
        eventId: args.eventId,
        timeZone: args.timeZone || undefined,
    });
    return response.data;
});

global.registerAction('googlecalendar/events-create', async ({ args = {} }: ActionParams, context: ActionContext) => {
    assertUsableCalendarId(args.calendarId);
    assertSummary(args.summary, { required: true });
    const allDay = toBoolean(args.allDay);
    if (allDay) assertAllDayRange(args.start, args.end);

    const calendar = getCalendarClient(context.connection);

    const response = await calendar.events.insert({
        calendarId: args.calendarId,
        sendUpdates: args.sendUpdates || undefined,
        requestBody: {
            summary: args.summary,
            start: buildEventTime(args.start, allDay, args.timeZone, { field: 'start' }),
            end: buildEventTime(args.end, allDay, args.timeZone, { field: 'end' }),
            description: args.description || undefined,
            location: args.location || undefined,
            attendees: args.attendees?.length ? args.attendees : undefined,
            recurrence: normalizeRecurrence(args.recurrence),
            reminders: buildReminders(args.reminders, args.reminderOverrides),
            visibility: args.visibility || undefined,
            transparency: args.transparency || undefined,
            colorId: args.colorId || undefined,
        },
    });
    return response.data;
});

global.registerAction('googlecalendar/events-update', async ({ args = {} }: ActionParams, context: ActionContext) => {
    assertUsableCalendarId(args.calendarId);
    assertSummary(args.summary, { required: false });
    // Resolved before the call: an unknown field name, or a cleared Title, must not reach Google.
    const fieldsToUpdate = resolveFieldsToUpdate(args._fields);
    const patchFields = buildUpdatePatchFields(args, fieldsToUpdate);
    // The time block only counts when "time" is picked (or no list was given at all).
    const { start, end, timeZone } = isTimeUpdateRequested(fieldsToUpdate) ? args : ({} as typeof args);
    const allDay = isTimeUpdateRequested(fieldsToUpdate) ? toBoolean(args.allDay) : false;
    if (allDay) assertAllDayRange(start, end);

    const calendar = getCalendarClient(context.connection);

    // A lone timeZone used to be dropped on the floor: buildEventTime only runs when start or
    // end is present, so the action answered 200 and changed nothing (WW-5994 QA C-06). Read
    // the event and rebuild its times in the new zone, keeping the wall-clock reading — the
    // same meaning "change time zone" has in Google Calendar's own UI. These feed the single
    // patch below, so any other field in the same update still applies.
    let rezonedTimes: { start: object; end: object } | undefined;
    // Not when the call says all-day: a zone left behind by the toggle (or a bound one) has
    // nothing to apply to, and must not quietly move the event.
    if (timeZone && !allDay && !start && !end) {
        const existing = await calendar.events.get({ calendarId: args.calendarId, eventId: args.eventId });
        if (existing.data.start?.date) {
            throw new Error(
                'Time Zone does not apply to an all-day event — all-day events have no time of day. ' +
                    'Turn "All-day event" off and provide Start and End to convert it to a timed event.'
            );
        }
        if (!existing.data.start?.dateTime || !existing.data.end?.dateTime) {
            throw new Error(`Event ${args.eventId} has no start and end time to move to another time zone.`);
        }
        rezonedTimes = {
            start: {
                dateTime: toWallClock(existing.data.start.dateTime, existing.data.start.timeZone ?? undefined),
                timeZone,
                date: null,
            },
            end: {
                dateTime: toWallClock(existing.data.end.dateTime, existing.data.end.timeZone ?? undefined),
                timeZone,
                date: null,
            },
        };
    }

    // events.patch, never events.update — update REPLACES the event and nulls every
    // omitted field; patch only touches the keys sent (root cause of the old
    // integration's update weirdness, WW-4726).
    const response = await calendar.events.patch({
        calendarId: args.calendarId,
        eventId: args.eventId,
        sendUpdates: args.sendUpdates || undefined,
        requestBody: {
            start: start ? buildEventTime(start, allDay, timeZone, { field: 'start', forPatch: true }) : rezonedTimes?.start,
            end: end ? buildEventTime(end, allDay, timeZone, { field: 'end', forPatch: true }) : rezonedTimes?.end,
            ...patchFields,
        },
    });
    return response.data;
});

global.registerAction('googlecalendar/events-delete', async ({ args = {} }: ActionParams, context: ActionContext) => {
    assertUsableCalendarId(args.calendarId);

    const calendar = getCalendarClient(context.connection);

    await calendar.events.delete({
        calendarId: args.calendarId,
        eventId: args.eventId,
        sendUpdates: args.sendUpdates || undefined,
    });
    return { success: true };
});
