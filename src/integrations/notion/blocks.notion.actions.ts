import { Client } from '@notionhq/client';
import { compactNotionParams } from './notion.utils.ts';

global.registerAction('notion/blocks-children-list', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const notion = new Client({ auth: context.connection?.apiKey });

    return await notion.blocks.children.list({
        block_id: args.block_id,
        ...compactNotionParams({
            start_cursor: args.start_cursor,
            page_size: args.page_size,
        }),
    });
});

global.registerAction('notion/blocks-update', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const notion = new Client({ auth: context.connection?.apiKey });

    return await notion.blocks.update({
        block_id: args.block_id,
        ...args.content,
    });
});

global.registerAction('notion/blocks-delete', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const notion = new Client({ auth: context.connection?.apiKey });

    return await notion.blocks.delete({
        block_id: args.block_id,
    });
});

global.registerAction('notion/blocks-children-append', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const notion = new Client({ auth: context.connection?.apiKey });

    return await notion.blocks.children.append({
        block_id: args.block_id,
        children: args.children ?? [],
    });
});
