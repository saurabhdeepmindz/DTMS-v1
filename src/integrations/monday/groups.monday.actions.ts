import { getMondayClient, compactVariables, GROUP_FIELDS } from './monday.utils.ts';

global.registerAction('monday/create-group', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getMondayClient(context.connection);

    const query = `mutation ($board_id: ID!, $group_name: String!, $group_color: String, $relative_to: String, $position_relative_method: PositionRelative) {
        create_group (board_id: $board_id, group_name: $group_name, group_color: $group_color, relative_to: $relative_to, position_relative_method: $position_relative_method) {
            ${GROUP_FIELDS}
        }
    }`;
    const data = await client.request<{ create_group: any }>(
        query,
        compactVariables({
            board_id: args.board_id,
            group_name: args.group_name,
            group_color: args.group_color,
            relative_to: args.relative_to,
            position_relative_method: args.position_relative_method,
        })
    );
    return data.create_group;
});

global.registerAction('monday/list-groups', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getMondayClient(context.connection);

    const query = `query ($board_id: [ID!], $ids: [String]) {
        boards (ids: $board_id) {
            groups (ids: $ids) { ${GROUP_FIELDS} }
        }
    }`;
    const data = await client.request<{ boards: any[] }>(
        query,
        compactVariables({
            board_id: [args.board_id],
            ids: args.ids,
        })
    );
    // Empty boards array = nonexistent/inaccessible board id, not "no groups".
    if (!data.boards?.length) throw new Error(`Board ${args.board_id} not found or not accessible with this connection`);
    return data.boards[0].groups ?? [];
});

global.registerAction('monday/update-group', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getMondayClient(context.connection);

    const query = `mutation ($board_id: ID!, $group_id: String!, $group_attribute: GroupAttributes!, $new_value: String!) {
        update_group (board_id: $board_id, group_id: $group_id, group_attribute: $group_attribute, new_value: $new_value) {
            ${GROUP_FIELDS}
        }
    }`;
    const data = await client.request<{ update_group: any }>(query, {
        board_id: args.board_id,
        group_id: args.group_id,
        group_attribute: args.group_attribute,
        new_value: args.new_value,
    });
    return data.update_group;
});

global.registerAction('monday/duplicate-group', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getMondayClient(context.connection);

    const query = `mutation ($board_id: ID!, $group_id: String!, $add_to_top: Boolean, $group_title: String) {
        duplicate_group (board_id: $board_id, group_id: $group_id, add_to_top: $add_to_top, group_title: $group_title) {
            ${GROUP_FIELDS}
        }
    }`;
    const data = await client.request<{ duplicate_group: any }>(
        query,
        compactVariables({
            board_id: args.board_id,
            group_id: args.group_id,
            add_to_top: args.add_to_top,
            group_title: args.group_title,
        })
    );
    return data.duplicate_group;
});

global.registerAction('monday/archive-group', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getMondayClient(context.connection);

    const query = `mutation ($board_id: ID!, $group_id: String!) {
        archive_group (board_id: $board_id, group_id: $group_id) { id archived }
    }`;
    const data = await client.request<{ archive_group: any }>(query, {
        board_id: args.board_id,
        group_id: args.group_id,
    });
    return data.archive_group;
});

global.registerAction('monday/delete-group', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getMondayClient(context.connection);

    const query = `mutation ($board_id: ID!, $group_id: String!) {
        delete_group (board_id: $board_id, group_id: $group_id) { id deleted }
    }`;
    const data = await client.request<{ delete_group: any }>(query, {
        board_id: args.board_id,
        group_id: args.group_id,
    });
    return data.delete_group;
});
