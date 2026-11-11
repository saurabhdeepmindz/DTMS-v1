import { getMondayClient, compactVariables, BOARD_FIELDS, COLUMN_FIELDS, GROUP_FIELDS } from './monday.utils.ts';

global.registerAction('monday/create-board', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getMondayClient(context.connection);

    const query = `mutation ($board_name: String!, $board_kind: BoardKind!, $description: String, $workspace_id: ID, $folder_id: ID, $template_id: ID, $board_owner_ids: [ID!], $board_owner_team_ids: [ID!], $board_subscriber_ids: [ID!], $board_subscriber_teams_ids: [ID!], $empty: Boolean) {
        create_board (board_name: $board_name, board_kind: $board_kind, description: $description, workspace_id: $workspace_id, folder_id: $folder_id, template_id: $template_id, board_owner_ids: $board_owner_ids, board_owner_team_ids: $board_owner_team_ids, board_subscriber_ids: $board_subscriber_ids, board_subscriber_teams_ids: $board_subscriber_teams_ids, empty: $empty) {
            ${BOARD_FIELDS}
        }
    }`;
    const data = await client.request<{ create_board: any }>(
        query,
        compactVariables({
            board_name: args.board_name,
            board_kind: args.board_kind,
            description: args.description,
            workspace_id: args.workspace_id,
            folder_id: args.folder_id,
            template_id: args.template_id,
            board_owner_ids: args.board_owner_ids,
            board_owner_team_ids: args.board_owner_team_ids,
            board_subscriber_ids: args.board_subscriber_ids,
            board_subscriber_teams_ids: args.board_subscriber_teams_ids,
            empty: args.empty,
        })
    );
    return data.create_board;
});

global.registerAction('monday/get-board', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getMondayClient(context.connection);

    const query = `query ($ids: [ID!], $state: State) {
        boards (ids: $ids, state: $state) {
            ${BOARD_FIELDS}
            columns { ${COLUMN_FIELDS} }
            groups { ${GROUP_FIELDS} }
        }
    }`;
    const data = await client.request<{ boards: any[] }>(
        query,
        compactVariables({
            ids: args.ids,
            state: args.state,
        })
    );
    return data.boards;
});

global.registerAction('monday/list-boards', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getMondayClient(context.connection);

    const query = `query ($limit: Int, $page: Int, $board_kind: BoardKind, $state: State, $workspace_ids: [ID], $order_by: BoardsOrderBy) {
        boards (limit: $limit, page: $page, board_kind: $board_kind, state: $state, workspace_ids: $workspace_ids, order_by: $order_by) {
            ${BOARD_FIELDS}
        }
    }`;
    const data = await client.request<{ boards: any[] }>(
        query,
        compactVariables({
            limit: args.limit ?? 25,
            page: args.page,
            board_kind: args.board_kind,
            state: args.state,
            workspace_ids: args.workspace_ids,
            order_by: args.order_by,
        })
    );
    return data.boards;
});

global.registerAction('monday/update-board', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getMondayClient(context.connection);

    const query = `mutation ($board_id: ID!, $board_attribute: BoardAttributes!, $new_value: String!) {
        update_board (board_id: $board_id, board_attribute: $board_attribute, new_value: $new_value)
    }`;
    const data = await client.request<{ update_board: any }>(query, {
        board_id: args.board_id,
        board_attribute: args.board_attribute,
        new_value: args.new_value,
    });
    return data.update_board;
});

global.registerAction('monday/duplicate-board', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getMondayClient(context.connection);

    const query = `mutation ($board_id: ID!, $duplicate_type: DuplicateBoardType!, $board_name: String, $workspace_id: ID, $folder_id: ID, $keep_subscribers: Boolean) {
        duplicate_board (board_id: $board_id, duplicate_type: $duplicate_type, board_name: $board_name, workspace_id: $workspace_id, folder_id: $folder_id, keep_subscribers: $keep_subscribers) {
            board { ${BOARD_FIELDS} }
        }
    }`;
    const data = await client.request<{ duplicate_board: any }>(
        query,
        compactVariables({
            board_id: args.board_id,
            duplicate_type: args.duplicate_type,
            board_name: args.board_name,
            workspace_id: args.workspace_id,
            folder_id: args.folder_id,
            keep_subscribers: args.keep_subscribers,
        })
    );
    return data.duplicate_board?.board;
});

global.registerAction('monday/archive-board', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getMondayClient(context.connection);

    const query = `mutation ($board_id: ID!) {
        archive_board (board_id: $board_id) { id state }
    }`;
    const data = await client.request<{ archive_board: any }>(query, { board_id: args.board_id });
    return data.archive_board;
});

global.registerAction('monday/delete-board', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getMondayClient(context.connection);

    const query = `mutation ($board_id: ID!) {
        delete_board (board_id: $board_id) { id state }
    }`;
    const data = await client.request<{ delete_board: any }>(query, { board_id: args.board_id });
    return data.delete_board;
});
