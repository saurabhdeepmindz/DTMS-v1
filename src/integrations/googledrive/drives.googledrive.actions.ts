import { getDriveClient } from './googledrive.utils.ts';

global.registerAction('googledrive/drives-list', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getDriveClient(context.connection);

    const response = await client.drives.list({
        pageSize: args.pageSize || undefined,
        pageToken: args.pageToken || undefined,
        fields: 'nextPageToken, drives(id, name, createdTime)',
    });

    return response.data;
});
