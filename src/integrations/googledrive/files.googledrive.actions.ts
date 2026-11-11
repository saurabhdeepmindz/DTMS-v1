import { Readable } from 'node:stream';
import { isDataURI, dataURIToBuffer, dataURIToContentType } from '../utils.ts';
import {
    getDriveClient,
    withTrashedFilter,
    rethrowWithDecodedBody,
    DEFAULT_LIST_FIELDS,
    DEFAULT_FILE_FIELDS,
} from './googledrive.utils.ts';

global.registerAction('googledrive/files-list', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getDriveClient(context.connection);

    const response = await client.files.list({
        q: withTrashedFilter(args.q),
        ...(args.driveId ? { driveId: args.driveId, corpora: 'drive' } : {}),
        orderBy: args.orderBy || undefined,
        pageSize: args.pageSize || undefined,
        pageToken: args.pageToken || undefined,
        fields: args.fields || DEFAULT_LIST_FIELDS,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
    });

    return response.data;
});

global.registerAction('googledrive/files-get', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getDriveClient(context.connection);

    const response = await client.files.get({
        fileId: args.fileId,
        fields: args.fields || DEFAULT_FILE_FIELDS,
        supportsAllDrives: true,
    });

    return response.data;
});

global.registerAction('googledrive/files-download', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getDriveClient(context.connection);

    const metadata = await client.files.get({
        fileId: args.fileId,
        fields: 'id, name, mimeType, size, shortcutDetails',
        supportsAllDrives: true,
    });

    const { name, mimeType, size, shortcutDetails } = metadata.data;
    if (mimeType === 'application/vnd.google-apps.shortcut') {
        throw new Error(
            `"${name}" is a shortcut, not a file — download its target instead (target file id: ${shortcutDetails?.targetId})`
        );
    }
    if (mimeType?.startsWith('application/vnd.google-apps.')) {
        throw new Error(
            `"${name}" is a Google-native file (${mimeType}) and has no binary content — use the Export File action instead`
        );
    }

    const response = await client.files
        .get({ fileId: args.fileId, alt: 'media', supportsAllDrives: true }, { responseType: 'arraybuffer' })
        .catch(rethrowWithDecodedBody);

    return {
        name,
        mimeType,
        size: size != null ? Number(size) : null,
        base64: Buffer.from(response.data as ArrayBuffer).toString('base64'),
    };
});

global.registerAction('googledrive/files-export', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getDriveClient(context.connection);

    const metadata = await client.files.get({
        fileId: args.fileId,
        fields: 'id, name, mimeType',
        supportsAllDrives: true,
    });

    const { name, mimeType } = metadata.data;
    if (!mimeType?.startsWith('application/vnd.google-apps.')) {
        throw new Error(
            `"${name}" is a binary file (${mimeType}) — only Google-native files (Docs, Sheets, Slides) can be exported. Use the Download File action instead`
        );
    }

    const response = await client.files
        .export({ fileId: args.fileId, mimeType: args.mimeType }, { responseType: 'arraybuffer' })
        .catch(rethrowWithDecodedBody);

    return {
        name,
        mimeType: args.mimeType,
        base64: Buffer.from(response.data as ArrayBuffer).toString('base64'),
    };
});

global.registerAction('googledrive/files-upload', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getDriveClient(context.connection);

    if (!args.contentUrl && !args.content) {
        throw new Error(
            "No file content provided — set either 'content' (a bound file, base64 or a data URI) or 'contentUrl' (a public URL). Refusing to create an empty file."
        );
    }

    let body: Buffer;
    let detectedMimeType: string | undefined;
    let detectedName: string | undefined;
    if (args.contentUrl) {
        const fetched = await fetch(args.contentUrl);
        if (!fetched.ok) {
            throw new Error(`Could not fetch the file from Content URL (HTTP ${fetched.status} ${fetched.statusText})`);
        }
        body = Buffer.from(await fetched.arrayBuffer());
        detectedMimeType = fetched.headers.get('content-type')?.split(';')[0] || undefined;
    } else if (args.content instanceof Blob) {
        // A bound file — e.g. an Upload element fed into a file-type workflow parameter
        body = Buffer.from(await args.content.arrayBuffer());
        detectedMimeType = args.content.type || undefined;
        detectedName = (args.content as File).name || undefined;
    } else if (isDataURI(args.content)) {
        body = dataURIToBuffer(args.content);
        detectedMimeType = dataURIToContentType(args.content) || undefined;
    } else {
        body = Buffer.from(args.content ?? '', 'base64');
    }

    const response = await client.files.create({
        requestBody: {
            name: args.name || detectedName || 'Untitled',
            parents: [args.folderId],
            ...(args.convertTo ? { mimeType: args.convertTo } : {}),
        },
        media: {
            mimeType: args.mimeType || detectedMimeType,
            body: Readable.from(body),
        },
        fields: DEFAULT_FILE_FIELDS,
        supportsAllDrives: true,
    });

    return response.data;
});

global.registerAction('googledrive/folders-create', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getDriveClient(context.connection);

    const response = await client.files.create({
        requestBody: {
            name: args.name,
            mimeType: 'application/vnd.google-apps.folder',
            parents: [args.folderId],
        },
        fields: DEFAULT_FILE_FIELDS,
        supportsAllDrives: true,
    });

    return response.data;
});

global.registerAction('googledrive/files-copy', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getDriveClient(context.connection);

    const response = await client.files.copy({
        fileId: args.fileId,
        requestBody: {
            ...(args.name ? { name: args.name } : {}),
            parents: [args.folderId],
        },
        fields: DEFAULT_FILE_FIELDS,
        supportsAllDrives: true,
    });

    return response.data;
});

global.registerAction('googledrive/files-update', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getDriveClient(context.connection);

    const requestBody: { name?: string; description?: string; starred?: boolean } = {};
    if (args.name) requestBody.name = args.name;
    if (args.description) requestBody.description = args.description;
    if (args.starred) requestBody.starred = args.starred === 'true';

    const response = await client.files.update({
        fileId: args.fileId,
        requestBody,
        addParents: args.addParents || undefined,
        removeParents: args.removeParents || undefined,
        fields: DEFAULT_FILE_FIELDS,
        supportsAllDrives: true,
    });

    return response.data;
});

global.registerAction('googledrive/files-trash', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getDriveClient(context.connection);

    const response = await client.files.update({
        fileId: args.fileId,
        requestBody: { trashed: true },
        fields: 'id, name, mimeType, trashed',
        supportsAllDrives: true,
    });

    return response.data;
});

global.registerAction('googledrive/files-delete', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getDriveClient(context.connection);

    await client.files.delete({
        fileId: args.fileId,
        supportsAllDrives: true,
    });

    return { success: true, fileId: args.fileId };
});
