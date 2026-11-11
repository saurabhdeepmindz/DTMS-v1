import { Client } from '@notionhq/client';
import { resolveNotionProperties } from './notion.utils.ts';

global.registerAction('notion/pages-retrieve', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const notion = new Client({ auth: context.connection?.apiKey });

    return await notion.pages.retrieve({
        page_id: args.page_id,
    });
});

global.registerAction('notion/pages-create', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const notion = new Client({ auth: context.connection?.apiKey });

    const properties = await resolveNotionProperties(notion, args.database_id, args.properties);

    return await notion.pages.create({
        parent: { data_source_id: args.database_id },
        properties,
        children: args.children,
    });
});

global.registerAction('notion/pages-update', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const notion = new Client({ auth: context.connection?.apiKey });

    // Update may not carry a database_id — derive the data source from the page so properties can be typed.
    let dataSourceId = args.database_id;
    if (!dataSourceId && args.properties && Object.keys(args.properties).length) {
        const page: any = await notion.pages.retrieve({ page_id: args.page_id });
        dataSourceId = page?.parent?.data_source_id ?? page?.parent?.database_id;
    }

    const properties = await resolveNotionProperties(notion, dataSourceId, args.properties);

    return await notion.pages.update({
        page_id: args.page_id,
        properties,
    });
});

global.registerAction('notion/pages-archive', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const notion = new Client({ auth: context.connection?.apiKey });

    return await notion.pages.update({
        page_id: args.page_id,
        archived: true,
    });
});
