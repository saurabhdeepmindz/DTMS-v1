import { getIntercomClient, buildSearchQuery } from './intercom.utils.ts';

// Three hardcoded tables (WW-4275): companies (page-numbered POST /companies/list),
// leads and users (cursor-paginated POST /contacts/search filtered by role).

global.registerTableView('intercom', async (connection: ConnectionConfig, table: TableConfig, view: ViewConfig) => {
    const client = getIntercomClient(connection);
    const limit = view.limit || 50;

    // .list()/.search() return a Fern pagination wrapper; read the native shape via .response.
    if (table.resource === 'companies') {
        const page = view.offset ? Number(view.offset) : 1;
        const result: any = (await client.companies.list({ page, per_page: limit, order: view.order })).response;
        const totalPages = result.pages?.total_pages ?? page;
        return {
            data: result.data || [],
            metadata: {
                limit,
                offset: view.offset || null,
                nextOffset: page < totalPages ? String(page + 1) : null,
            },
        };
    }

    if (table.resource === 'leads' || table.resource === 'users') {
        const role = table.resource === 'leads' ? 'lead' : 'user';
        const roleFilter = { field: 'role', operator: '=', value: role };
        const userQuery = buildSearchQuery(view);
        const query = userQuery ? { operator: 'AND', value: [roleFilter, userQuery] } : roleFilter;

        const result: any = (
            await client.contacts.search({
                query: query as any,
                pagination: {
                    per_page: limit,
                    starting_after: view.offset || undefined,
                },
            })
        ).response;
        return {
            data: result.data || [],
            metadata: {
                limit,
                offset: view.offset || null,
                nextOffset: result.pages?.next?.starting_after ?? null,
            },
        };
    }

    throw new Error(`Unsupported Intercom table resource: ${table.resource}`);
});
