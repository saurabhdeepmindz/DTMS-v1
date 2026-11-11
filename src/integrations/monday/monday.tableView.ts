import { getMondayClient, ITEM_FIELDS } from './monday.utils.ts';

global.registerTableView('monday', async (connection: ConnectionConfig, table: TableConfig, view: ViewConfig) => {
    const client = getMondayClient(connection);
    if (!table.board_id) throw new Error('monday table view: board_id is not configured');

    const limit = view.limit || 100;

    // Cursor-based only: the first page scopes by board;
    // subsequent pages must go through next_items_page — query scope and cursor are
    // mutually exclusive in the monday API.
    let page: { cursor: string | null; items: any[] };
    if (view.offset) {
        const query = `query ($cursor: String!, $limit: Int!) {
            next_items_page (cursor: $cursor, limit: $limit) {
                cursor
                items { ${ITEM_FIELDS} }
            }
        }`;
        const data = await client.request<{ next_items_page: any }>(query, { cursor: view.offset, limit });
        page = data.next_items_page;
    } else {
        // Group filter and sort go through query_params on the FIRST page only — the cursor
        // carries them forward (query_params + cursor together are rejected by monday).
        // Verified live: group filter is a rule on the virtual "group" column; created/updated
        // sorts use the virtual "__creation_log__"/"__last_updated__" columns.
        const queryParams: Record<string, any> = {};
        if (view.group_id) {
            queryParams.rules = [{ column_id: 'group', compare_value: [view.group_id], operator: 'any_of' }];
        }
        if (view.sort_by) {
            queryParams.order_by = [{ column_id: view.sort_by, direction: view.sort_direction || 'asc' }];
        }

        const query = `query ($board_id: [ID!], $limit: Int!, $query_params: ItemsQuery) {
            boards (ids: $board_id) {
                items_page (limit: $limit, query_params: $query_params) {
                    cursor
                    items { ${ITEM_FIELDS} }
                }
            }
        }`;
        const data = await client.request<{ boards: any[] }>(query, {
            board_id: [table.board_id],
            limit,
            query_params: Object.keys(queryParams).length ? queryParams : undefined,
        });
        page = data.boards?.[0]?.items_page;
    }

    if (!page) throw new Error(`monday table view: board ${table.board_id} not found or not accessible`);

    return {
        data: page.items || [],
        metadata: {
            limit,
            offset: view.offset || null,
            nextOffset: page.cursor || null,
        },
    };
});
