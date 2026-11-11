import { getDriveClient, withTrashedFilter, DEFAULT_LIST_FIELDS } from './googledrive.utils.ts';

global.registerTableView(
    'googledrive',
    async (connection: ConnectionConfig, table: TableConfig, view: ViewConfig) => {
        if (table.resource !== 'files') {
            throw new Error(`Unsupported Google Drive table resource: ${table.resource}`);
        }

        const client = getDriveClient(connection);

        const qParts: string[] = [];
        if (view.folderId) qParts.push(`'${view.folderId}' in parents`);
        if (view.q) qParts.push(`(${view.q})`);

        const response = await client.files.list({
            q: withTrashedFilter(qParts.join(' and ') || undefined),
            ...(view.driveId ? { driveId: view.driveId, corpora: 'drive' } : {}),
            orderBy: view.orderBy || undefined,
            pageSize: view.limit || 100,
            pageToken: view.offset || undefined,
            fields: DEFAULT_LIST_FIELDS,
            supportsAllDrives: true,
            includeItemsFromAllDrives: true,
        });

        return {
            data: response.data.files || [],
            metadata: {
                limit: view.limit || 100,
                offset: view.offset || null,
                nextOffset: response.data.nextPageToken || null,
            },
        };
    }
);
