import {
    getCalendarClient,
    assertTimeFilter,
    assertUsableCalendarId,
    describeGoogleError,
    toWholeNumber,
    EVENTS_PAGE_MAX,
} from './googlecalendar.utils.ts';

global.registerTableView('googlecalendar', async (connection: ConnectionConfig, table: TableConfig, view: ViewConfig) => {
    const calendar = getCalendarClient(connection);

    if (!table?.calendarId) {
        throw new Error('Google Calendar table is missing its calendar — set `calendarId` in the table configuration.');
    }

    assertUsableCalendarId(table.calendarId);

    if (view.timeMin) assertTimeFilter(view.timeMin, 'timeMin');
    if (view.timeMax) assertTimeFilter(view.timeMax, 'timeMax');

    // Google caps a page at 250. Accepting limit=300 and echoing it back in the metadata told
    // the caller 300 rows were coming when 250 was the ceiling (WW-5994 QA C-11) — clamp once
    // and report the number that is actually honored.
    const limit = Math.min(toWholeNumber(view.limit, 'limit', { min: 1 }) ?? 100, EVENTS_PAGE_MAX);

    // An expired or malformed pageToken makes Google answer 400 "Invalid page token value.",
    // which the platform's error middleware flattens into a detail-less 500 (WW-5994 QA
    // C-11) — restate it so the caller can see what to do.
    let response;
    try {
        response = await calendar.events.list({
            calendarId: table.calendarId,
            timeMin: view.timeMin || undefined,
            timeMax: view.timeMax || undefined,
            q: view.q || undefined,
            // pinned true for the view: recurring events arrive as concrete instances (rows
            // need real dates) and it keeps orderBy=startTime always legal.
            singleEvents: true,
            orderBy: view.orderBy || undefined,
            maxResults: limit,
            pageToken: view.offset || undefined,
        });
    } catch (error) {
        const detail = describeGoogleError(error);
        if (!detail) throw error;
        throw new Error(
            view.offset
                ? `${detail} The pagination cursor is invalid or expired — reload the view from the first page.`
                : detail
        );
    }

    return {
        data: response.data.items ?? [],
        metadata: {
            limit,
            offset: view.offset || null,
            nextOffset: response.data.nextPageToken ?? null,
        },
    };
});
