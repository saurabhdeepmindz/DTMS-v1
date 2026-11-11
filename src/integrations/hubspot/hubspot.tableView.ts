import { getHubspotClient, emptyToUndefined, cleanFilterGroups, cleanSorts } from './hubspot.utils.ts';

// Five resources (WW-5888): contacts, companies, deals, tickets, engagements (which adds
// a `type` sub-selector). All go through the generic /crm/v3/objects/{type} endpoints.
// Views with filters/sorts use the search endpoint (200/page, 10,000-row depth cap,
// 5 req/s); unfiltered views use the plain list endpoint (100/page). Both paginate with
// a string `after` cursor.

const ENGAGEMENT_TYPES = ['meetings', 'calls', 'emails', 'notes', 'tasks', 'communications', 'postal_mail'];
const CRM_RESOURCES = ['contacts', 'companies', 'deals', 'tickets'];

global.registerTableView('hubspot', async (connection: ConnectionConfig, table: TableConfig, view: ViewConfig) => {
    let objectType = table.resource;
    if (table.resource === 'engagements') {
        if (!ENGAGEMENT_TYPES.includes(table.type)) {
            throw new Error(`Unsupported HubSpot engagement type: ${table.type}`);
        }
        objectType = table.type;
    } else if (!CRM_RESOURCES.includes(table.resource)) {
        throw new Error(`Unsupported HubSpot table resource: ${table.resource}`);
    }

    const client = getHubspotClient(connection);
    const limit = view.limit || 50;
    const filterGroups = cleanFilterGroups(view.filterGroups);
    const sorts = cleanSorts(view.sorts);

    let results: any[] | undefined;
    let nextAfter: string | undefined;
    if (filterGroups || sorts) {
        const response = await client.crm.objects.searchApi.doSearch(objectType, {
            filterGroups,
            sorts,
            properties: emptyToUndefined(view.properties),
            limit,
            after: emptyToUndefined(view.offset),
        } as any);
        results = response.results;
        nextAfter = response.paging?.next?.after;
    } else {
        const response = await client.crm.objects.basicApi.getPage(
            objectType,
            limit,
            emptyToUndefined(view.offset),
            emptyToUndefined(view.properties)
        );
        results = response.results;
        nextAfter = response.paging?.next?.after;
    }

    return {
        data: results || [],
        metadata: {
            limit,
            offset: view.offset || null,
            nextOffset: nextAfter ?? null,
        },
    };
});
