import { getMondayClient, compactVariables, asJsonString, COLUMN_FIELDS, ITEM_FIELDS } from './monday.utils.ts';

global.registerAction('monday/create-column', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getMondayClient(context.connection);

    const query = `mutation ($board_id: ID!, $title: String!, $column_type: ColumnType!, $description: String, $id: String, $defaults: JSON, $after_column_id: ID) {
        create_column (board_id: $board_id, title: $title, column_type: $column_type, description: $description, id: $id, defaults: $defaults, after_column_id: $after_column_id) {
            ${COLUMN_FIELDS}
        }
    }`;
    const data = await client.request<{ create_column: any }>(
        query,
        compactVariables({
            board_id: args.board_id,
            title: args.title,
            column_type: args.column_type,
            description: args.description,
            id: args.id,
            defaults: asJsonString(args.defaults),
            after_column_id: args.after_column_id,
        })
    );
    return data.create_column;
});

global.registerAction('monday/list-columns', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getMondayClient(context.connection);

    const query = `query ($board_id: [ID!], $ids: [String], $types: [ColumnType!]) {
        boards (ids: $board_id) {
            columns (ids: $ids, types: $types) { ${COLUMN_FIELDS} }
        }
    }`;
    const data = await client.request<{ boards: any[] }>(
        query,
        compactVariables({
            board_id: [args.board_id],
            ids: args.ids,
            types: args.types,
        })
    );
    // Empty boards array = nonexistent/inaccessible board id, not "no columns".
    if (!data.boards?.length) throw new Error(`Board ${args.board_id} not found or not accessible with this connection`);
    return data.boards[0].columns ?? [];
});

global.registerAction('monday/change-column-value', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getMondayClient(context.connection);

    const query = `mutation ($board_id: ID!, $item_id: ID!, $column_id: String!, $value: JSON!, $create_labels_if_missing: Boolean) {
        change_column_value (board_id: $board_id, item_id: $item_id, column_id: $column_id, value: $value, create_labels_if_missing: $create_labels_if_missing) {
            ${ITEM_FIELDS}
        }
    }`;
    const data = await client.request<{ change_column_value: any }>(
        query,
        compactVariables({
            board_id: args.board_id,
            item_id: args.item_id,
            column_id: args.column_id,
            value: asJsonString(args.value),
            create_labels_if_missing: args.create_labels_if_missing,
        })
    );
    return data.change_column_value;
});

global.registerAction('monday/change-simple-column-value', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getMondayClient(context.connection);

    const query = `mutation ($board_id: ID!, $item_id: ID!, $column_id: String!, $value: String, $create_labels_if_missing: Boolean) {
        change_simple_column_value (board_id: $board_id, item_id: $item_id, column_id: $column_id, value: $value, create_labels_if_missing: $create_labels_if_missing) {
            ${ITEM_FIELDS}
        }
    }`;
    const data = await client.request<{ change_simple_column_value: any }>(
        query,
        compactVariables({
            board_id: args.board_id,
            item_id: args.item_id,
            column_id: args.column_id,
            value: args.value,
            create_labels_if_missing: args.create_labels_if_missing,
        })
    );
    return data.change_simple_column_value;
});

global.registerAction('monday/change-multiple-column-values', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getMondayClient(context.connection);

    const query = `mutation ($board_id: ID!, $item_id: ID!, $column_values: JSON!, $create_labels_if_missing: Boolean) {
        change_multiple_column_values (board_id: $board_id, item_id: $item_id, column_values: $column_values, create_labels_if_missing: $create_labels_if_missing) {
            ${ITEM_FIELDS}
        }
    }`;
    const data = await client.request<{ change_multiple_column_values: any }>(
        query,
        compactVariables({
            board_id: args.board_id,
            item_id: args.item_id,
            column_values: asJsonString(args.column_values),
            create_labels_if_missing: args.create_labels_if_missing,
        })
    );
    return data.change_multiple_column_values;
});

global.registerAction('monday/change-column-title', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getMondayClient(context.connection);

    const query = `mutation ($board_id: ID!, $column_id: String!, $title: String!) {
        change_column_title (board_id: $board_id, column_id: $column_id, title: $title) {
            ${COLUMN_FIELDS}
        }
    }`;
    const data = await client.request<{ change_column_title: any }>(query, {
        board_id: args.board_id,
        column_id: args.column_id,
        title: args.title,
    });
    return data.change_column_title;
});

global.registerAction('monday/delete-column', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getMondayClient(context.connection);

    const query = `mutation ($board_id: ID!, $column_id: String!) {
        delete_column (board_id: $board_id, column_id: $column_id) { id }
    }`;
    const data = await client.request<{ delete_column: any }>(query, {
        board_id: args.board_id,
        column_id: args.column_id,
    });
    return data.delete_column;
});
