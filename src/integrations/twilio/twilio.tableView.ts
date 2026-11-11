import { getClient, serialize, extractPageToken } from './twilio.utils.ts';

// Filters each resource accepts. Used to reject a filter that belongs to a different resource.
const RESOURCE_FILTERS: Record<string, string[]> = {
    messages: ['to', 'from', 'dateSent'],
    calls: ['to', 'from', 'status', 'startTime'],
};

global.registerTableView('twilio', async (connection: ConnectionConfig, table: TableConfig, view: ViewConfig) => {
    const resource = table.resource;
    const allowedFilters = RESOURCE_FILTERS[resource];
    if (!allowedFilters) {
        throw new Error(
            `Invalid Twilio table resource "${resource}". Valid resources are: ${Object.keys(RESOURCE_FILTERS).join(', ')}.`
        );
    }

    // Only reject filters that belong to a *different* resource (e.g. calls-only `status` on
    // messages). Keys the fetch path injects into the view (e.g. formulaColumns, pagination) are
    // ignored, not rejected — the handler forwards only the keys it reads below.
    const foreignFilters = Object.values(RESOURCE_FILTERS)
        .flat()
        .filter(key => !allowedFilters.includes(key));
    const viewKeys = view as Record<string, any>;
    const invalidFilters = Object.keys(viewKeys).filter(
        key =>
            foreignFilters.includes(key) &&
            viewKeys[key] !== undefined &&
            viewKeys[key] !== null &&
            viewKeys[key] !== ''
    );
    if (invalidFilters.length) {
        throw new Error(
            `Invalid filter(s) for Twilio "${resource}" resource: ${invalidFilters.join(', ')}. ` +
                `Valid filters are: ${allowedFilters.join(', ')}.`
        );
    }

    const client = getClient(connection);
    const pageSize = view.limit || 50;

    let page: any;
    switch (resource) {
        case 'messages': {
            page = await client.messages.page({
                pageSize,
                pageToken: view.offset || undefined,
                to: view.to,
                from: view.from,
                dateSent: view.dateSent ? new Date(view.dateSent) : undefined,
            });
            break;
        }
        case 'calls': {
            page = await client.calls.page({
                pageSize,
                pageToken: view.offset || undefined,
                to: view.to,
                from: view.from,
                status: view.status,
                startTime: view.startTime ? new Date(view.startTime) : undefined,
            });
            break;
        }
        default:
            throw new Error(`Unsupported Twilio table resource: ${table.resource}`);
    }

    return {
        data: (page.instances || []).map(serialize),
        metadata: {
            limit: pageSize,
            offset: view.offset || null,
            nextOffset: extractPageToken(page.nextPageUrl),
        },
    };
});
