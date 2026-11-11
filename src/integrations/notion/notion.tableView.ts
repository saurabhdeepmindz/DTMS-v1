import { Client } from '@notionhq/client';
import { compactNotionParams } from './notion.utils.ts';

global.registerTableView('notion', async (connection: ConnectionConfig, table: TableConfig, view: ViewConfig) => {
    const notion = new Client({ auth: connection?.apiKey });

    const response = await notion.dataSources.query({
        data_source_id: table.database_id,
        ...compactNotionParams({
            filter: view.filter,
            sorts: view.sorts,
            // numeric-offset callers (editor test / MCP fetch) send 0 for the first
            // page — a Notion cursor is an opaque string, so 0/'0' means "no cursor"
            start_cursor: view.offset === 0 || view.offset === '0' ? undefined : view.offset,
        }),
        page_size: view.limit ?? 100,
    });

    return {
        data: response.results || [],
        metadata: {
            limit: view.limit ?? 100,
            offset: view.offset ?? null,
            nextOffset: response.next_cursor ?? null,
        },
    };
});
