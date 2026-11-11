import { getCalendarClient } from './googlecalendar.utils.ts';

global.registerAction('googlecalendar/calendars-list', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const calendar = getCalendarClient(context.connection);

    const calendars = [];
    let pageToken: string | undefined;
    do {
        const response = await calendar.calendarList.list({ pageToken, showHidden: true });
        calendars.push(...(response.data.items ?? []));
        pageToken = response.data.nextPageToken ?? undefined;
    } while (pageToken);

    return { calendars };
});
