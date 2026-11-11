import { getDriveClient } from './googledrive.utils.ts';

global.registerAction('googledrive/permissions-create', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getDriveClient(context.connection);

    const response = await client.permissions.create({
        fileId: args.fileId,
        requestBody: {
            type: args.type,
            role: args.role,
            ...(args.emailAddress ? { emailAddress: args.emailAddress } : {}),
            ...(args.domain ? { domain: args.domain } : {}),
        },
        ...(args.sendNotificationEmail ? { sendNotificationEmail: args.sendNotificationEmail === 'true' } : {}),
        fields: 'id, type, role, emailAddress, domain, displayName',
        supportsAllDrives: true,
    });

    return response.data;
});

global.registerAction('googledrive/permissions-list', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getDriveClient(context.connection);

    const response = await client.permissions.list({
        fileId: args.fileId,
        fields: 'permissions(id, emailAddress, domain, role, type, displayName, deleted)',
        supportsAllDrives: true,
    });

    return response.data;
});

global.registerAction('googledrive/permissions-delete', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getDriveClient(context.connection);

    await client.permissions.delete({
        fileId: args.fileId,
        permissionId: args.permissionId,
        supportsAllDrives: true,
    });

    return { success: true, permissionId: args.permissionId };
});
