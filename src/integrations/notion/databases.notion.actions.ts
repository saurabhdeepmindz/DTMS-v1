import { Client } from '@notionhq/client';
import { compactNotionParams } from './notion.utils.ts';

global.registerAction('notion/databases-query', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const notion = new Client({ auth: context.connection?.apiKey });

    return await notion.dataSources.query({
        data_source_id: args.database_id,
        ...compactNotionParams({
            filter: args.filter,
            sorts: args.sorts,
            start_cursor: args.start_cursor,
            page_size: args.page_size,
        }),
    });
});

global.registerAction('notion/databases-retrieve', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const notion = new Client({ auth: context.connection?.apiKey });

    return await notion.dataSources.retrieve({
        data_source_id: args.database_id,
    });
});

global.registerAction('notion/databases-search', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const notion = new Client({ auth: context.connection?.apiKey });

    return await notion.search(
        compactNotionParams({
            query: args.query,
            filter: args.filter,
            sort: args.sort,
            start_cursor: args.start_cursor,
            page_size: args.page_size,
        })
    );
});
