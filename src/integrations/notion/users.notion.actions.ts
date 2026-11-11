import { Client } from '@notionhq/client';
import { compactNotionParams } from './notion.utils.ts';

global.registerAction('notion/users-list', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const notion = new Client({ auth: context.connection?.apiKey });

    return await notion.users.list(
        compactNotionParams({
            start_cursor: args.start_cursor,
            page_size: args.page_size,
        })
    );
});

global.registerAction('notion/users-retrieve', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const notion = new Client({ auth: context.connection?.apiKey });

    return await notion.users.retrieve({
        user_id: args.user_id,
    });
});
