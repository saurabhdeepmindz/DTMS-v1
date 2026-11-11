import { getMondayClient, compactVariables, asJsonString, ITEM_FIELDS } from './monday.utils.ts';

global.registerAction('monday/create-item', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getMondayClient(context.connection);

    const query = `mutation ($board_id: ID!, $item_name: String!, $group_id: String, $column_values: JSON, $create_labels_if_missing: Boolean, $position_relative_method: PositionRelative, $relative_to: ID) {
        create_item (board_id: $board_id, item_name: $item_name, group_id: $group_id, column_values: $column_values, create_labels_if_missing: $create_labels_if_missing, position_relative_method: $position_relative_method, relative_to: $relative_to) {
            ${ITEM_FIELDS}
        }
    }`;
    const data = await client.request<{ create_item: any }>(
        query,
        compactVariables({
            board_id: args.board_id,
            item_name: args.item_name,
            group_id: args.group_id,
            column_values: asJsonString(args.column_values),
            create_labels_if_missing: args.create_labels_if_missing,
            position_relative_method: args.position_relative_method,
            relative_to: args.relative_to,
        })
    );
    return data.create_item;
});

global.registerAction('monday/get-item', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getMondayClient(context.connection);

    const query = `query ($ids: [ID!]) {
        items (ids: $ids) {
            ${ITEM_FIELDS}
            parent_item { id name }
        }
    }`;
    const data = await client.request<{ items: any[] }>(query, compactVariables({ ids: args.ids }));
    return data.items;
});

global.registerAction('monday/list-items', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getMondayClient(context.connection);
    const limit = args.limit ?? 25;

    // items_page cursors are board-independent: continuation goes through the dedicated
    // top-level query (cursor and query scope can't be combined).
    if (args.cursor) {
        const query = `query ($cursor: String!, $limit: Int!) {
            next_items_page (cursor: $cursor, limit: $limit) {
                cursor
                items { ${ITEM_FIELDS} }
            }
        }`;
        const data = await client.request<{ next_items_page: any }>(query, { cursor: args.cursor, limit });
        return data.next_items_page;
    }

    const query = `query ($board_id: [ID!], $limit: Int!) {
        boards (ids: $board_id) {
            items_page (limit: $limit) {
                cursor
                items { ${ITEM_FIELDS} }
            }
        }
    }`;
    const data = await client.request<{ boards: any[] }>(query, { board_id: [args.board_id], limit });
    // monday returns an empty boards array for a nonexistent/inaccessible id — surface it
    // instead of returning an empty page indistinguishable from "board exists but is empty".
    if (!data.boards?.length) throw new Error(`Board ${args.board_id} not found or not accessible with this connection`);
    return data.boards[0].items_page;
});

global.registerAction('monday/get-items-by-column-value', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getMondayClient(context.connection);

    const query = `query ($board_id: ID!, $columns: [ItemsPageByColumnValuesQuery!], $limit: Int!, $cursor: String) {
        items_page_by_column_values (board_id: $board_id, columns: $columns, limit: $limit, cursor: $cursor) {
            cursor
            items { ${ITEM_FIELDS} }
        }
    }`;
    const data = await client.request<{ items_page_by_column_values: any }>(
        query,
        compactVariables({
            board_id: args.board_id,
            // monday rejects columns + cursor together ("provide either 'columns' or 'cursor',
            // but not both"): columns filter the first page, the cursor carries them forward.
            columns: args.cursor ? undefined : args.columns,
            limit: args.limit ?? 25,
            cursor: args.cursor,
        })
    );
    return data.items_page_by_column_values;
});

// change_item_name was removed from the API — the name column is updated like any other.
global.registerAction('monday/change-item-name', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getMondayClient(context.connection);

    const query = `mutation ($board_id: ID!, $item_id: ID!, $value: String) {
        change_simple_column_value (board_id: $board_id, item_id: $item_id, column_id: "name", value: $value) {
            ${ITEM_FIELDS}
        }
    }`;
    const data = await client.request<{ change_simple_column_value: any }>(query, {
        board_id: args.board_id,
        item_id: args.item_id,
        value: args.name,
    });
    return data.change_simple_column_value;
});

global.registerAction('monday/move-item-to-group', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getMondayClient(context.connection);

    const query = `mutation ($item_id: ID!, $group_id: String!) {
        move_item_to_group (item_id: $item_id, group_id: $group_id) {
            ${ITEM_FIELDS}
        }
    }`;
    const data = await client.request<{ move_item_to_group: any }>(query, {
        item_id: args.item_id,
        group_id: args.group_id,
    });
    return data.move_item_to_group;
});

global.registerAction('monday/move-item-to-board', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getMondayClient(context.connection);

    const query = `mutation ($board_id: ID!, $group_id: ID!, $item_id: ID!, $columns_mapping: [ColumnMappingInput!], $subitems_columns_mapping: [ColumnMappingInput!]) {
        move_item_to_board (board_id: $board_id, group_id: $group_id, item_id: $item_id, columns_mapping: $columns_mapping, subitems_columns_mapping: $subitems_columns_mapping) {
            ${ITEM_FIELDS}
        }
    }`;
    const data = await client.request<{ move_item_to_board: any }>(
        query,
        compactVariables({
            board_id: args.board_id,
            group_id: args.group_id,
            item_id: args.item_id,
            columns_mapping: args.columns_mapping,
            subitems_columns_mapping: args.subitems_columns_mapping,
        })
    );
    return data.move_item_to_board;
});

global.registerAction('monday/archive-item', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getMondayClient(context.connection);

    const query = `mutation ($item_id: ID!) {
        archive_item (item_id: $item_id) { id state }
    }`;
    const data = await client.request<{ archive_item: any }>(query, { item_id: args.item_id });
    return data.archive_item;
});

global.registerAction('monday/duplicate-item', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getMondayClient(context.connection);

    const query = `mutation ($board_id: ID!, $item_id: ID, $with_updates: Boolean) {
        duplicate_item (board_id: $board_id, item_id: $item_id, with_updates: $with_updates) {
            ${ITEM_FIELDS}
        }
    }`;
    const data = await client.request<{ duplicate_item: any }>(
        query,
        compactVariables({
            board_id: args.board_id,
            item_id: args.item_id,
            with_updates: args.with_updates,
        })
    );
    return data.duplicate_item;
});

global.registerAction('monday/delete-item', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getMondayClient(context.connection);

    const query = `mutation ($item_id: ID!) {
        delete_item (item_id: $item_id) { id state }
    }`;
    const data = await client.request<{ delete_item: any }>(query, { item_id: args.item_id });
    return data.delete_item;
});
