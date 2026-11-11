import { getMondayClient, compactVariables, asJsonString, ITEM_FIELDS } from './monday.utils.ts';

global.registerAction('monday/create-subitem', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getMondayClient(context.connection);

    const query = `mutation ($parent_item_id: ID!, $item_name: String!, $column_values: JSON, $create_labels_if_missing: Boolean) {
        create_subitem (parent_item_id: $parent_item_id, item_name: $item_name, column_values: $column_values, create_labels_if_missing: $create_labels_if_missing) {
            ${ITEM_FIELDS}
            parent_item { id name }
        }
    }`;
    const data = await client.request<{ create_subitem: any }>(
        query,
        compactVariables({
            parent_item_id: args.parent_item_id,
            item_name: args.item_name,
            column_values: asJsonString(args.column_values),
            create_labels_if_missing: args.create_labels_if_missing,
        })
    );
    return data.create_subitem;
});

global.registerAction('monday/list-subitems', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getMondayClient(context.connection);

    const query = `query ($item_id: [ID!]) {
        items (ids: $item_id) {
            subitems { ${ITEM_FIELDS} }
        }
    }`;
    const data = await client.request<{ items: any[] }>(query, { item_id: [args.item_id] });
    return data.items?.[0]?.subitems ?? [];
});
