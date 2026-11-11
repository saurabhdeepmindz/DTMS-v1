import { getMondayClient, compactVariables, UPDATE_FIELDS } from './monday.utils.ts';

global.registerAction('monday/create-update', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getMondayClient(context.connection);

    const query = `mutation ($item_id: ID, $body: String!, $parent_id: ID, $mentions_list: [UpdateMention]) {
        create_update (item_id: $item_id, body: $body, parent_id: $parent_id, mentions_list: $mentions_list) {
            ${UPDATE_FIELDS}
        }
    }`;
    const data = await client.request<{ create_update: any }>(
        query,
        compactVariables({
            item_id: args.item_id,
            body: args.body,
            parent_id: args.parent_id,
            mentions_list: args.mentions_list,
        })
    );
    return data.create_update;
});

global.registerAction('monday/list-updates', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getMondayClient(context.connection);

    const query = `query ($item_id: [ID!], $limit: Int, $page: Int) {
        items (ids: $item_id) {
            updates (limit: $limit, page: $page) { ${UPDATE_FIELDS} }
        }
    }`;
    const data = await client.request<{ items: any[] }>(
        query,
        compactVariables({
            item_id: [args.item_id],
            limit: args.limit ?? 25,
            page: args.page,
        })
    );
    return data.items?.[0]?.updates ?? [];
});

global.registerAction('monday/edit-update', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getMondayClient(context.connection);

    const query = `mutation ($id: ID!, $body: String!) {
        edit_update (id: $id, body: $body) { ${UPDATE_FIELDS} }
    }`;
    const data = await client.request<{ edit_update: any }>(query, { id: args.id, body: args.body });
    return data.edit_update;
});

global.registerAction('monday/delete-update', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getMondayClient(context.connection);

    const query = `mutation ($id: ID!) {
        delete_update (id: $id) { id }
    }`;
    const data = await client.request<{ delete_update: any }>(query, { id: args.id });
    return data.delete_update;
});
