import {
    getDocsClient,
    getDriveClient,
    rethrowWithDecodedBody,
    buildReplaceRequests,
    occurrencesFromReplies,
} from './googledocs.utils.ts';

const GOOGLE_DOC_MIME_TYPE = 'application/vnd.google-apps.document';

global.registerAction('googledocs/documents-create-from-template', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const driveClient = getDriveClient(context.connection);
    const docsClient = getDocsClient(context.connection);

    // The copy is owned by the destination Shared Drive — a My Drive folder would 403
    // (service accounts have no storage quota).
    const copy = await driveClient.files.copy({
        fileId: args.templateId,
        requestBody: {
            name: args.name,
            parents: [args.folderId],
        },
        fields: 'id, name, webViewLink',
        supportsAllDrives: true,
    });

    const documentId = copy.data.id as string;
    const requests = buildReplaceRequests(args.replacements, true);
    let occurrencesChanged: Record<string, number> = {};
    if (requests.length) {
        const response = await docsClient.documents.batchUpdate({
            documentId,
            requestBody: { requests },
        });
        occurrencesChanged = occurrencesFromReplies(requests, response.data.replies ?? undefined);
    }

    return { documentId, name: copy.data.name, webViewLink: copy.data.webViewLink, occurrencesChanged };
});

global.registerAction('googledocs/documents-replace-text', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const docsClient = getDocsClient(context.connection);

    const matchCase = !(args.matchCase === false || args.matchCase === 'false');
    const requests = buildReplaceRequests(args.replacements, matchCase);
    if (!requests.length) {
        throw new Error("No replacements provided — 'replacements' must map the text to search for to its replacement value.");
    }

    const response = await docsClient.documents.batchUpdate({
        documentId: args.documentId,
        requestBody: { requests },
    });

    return {
        documentId: args.documentId,
        occurrencesChanged: occurrencesFromReplies(requests, response.data.replies ?? undefined),
    };
});

global.registerAction('googledocs/documents-append-text', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const docsClient = getDocsClient(context.connection);

    // endOfSegmentLocation is index-free — immune to the UTF-16 index drift that makes
    // location-based inserts fragile.
    await docsClient.documents.batchUpdate({
        documentId: args.documentId,
        requestBody: {
            requests: [{ insertText: { endOfSegmentLocation: {}, text: args.text } }],
        },
    });

    return { documentId: args.documentId };
});

global.registerAction('googledocs/documents-get-text', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const driveClient = getDriveClient(context.connection);

    // Plain-text export is saner than walking the body.content StructuralElement tree.
    const response = await driveClient.files
        .export({ fileId: args.documentId, mimeType: 'text/plain' }, { responseType: 'arraybuffer' })
        .catch(rethrowWithDecodedBody);

    return { text: Buffer.from(response.data as ArrayBuffer).toString('utf8') };
});

global.registerAction('googledocs/documents-get', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const docsClient = getDocsClient(context.connection);

    const response = await docsClient.documents.get({
        documentId: args.documentId,
        // Without this, tabs beyond the first are silently missing from the response.
        includeTabsContent: true,
        suggestionsViewMode: args.suggestionsViewMode || undefined,
    });

    return response.data;
});

global.registerAction('googledocs/documents-export', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const driveClient = getDriveClient(context.connection);

    const metadata = await driveClient.files.get({
        fileId: args.documentId,
        fields: 'id, name, mimeType',
        supportsAllDrives: true,
    });

    const { name, mimeType } = metadata.data;
    if (mimeType !== GOOGLE_DOC_MIME_TYPE) {
        throw new Error(`"${name}" is not a Google Doc (${mimeType}) — this action only exports Google Docs documents.`);
    }

    const response = await driveClient.files
        .export({ fileId: args.documentId, mimeType: args.mimeType }, { responseType: 'arraybuffer' })
        .catch(rethrowWithDecodedBody);

    return {
        name,
        mimeType: args.mimeType,
        base64: Buffer.from(response.data as ArrayBuffer).toString('base64'),
    };
});

global.registerAction('googledocs/documents-create-blank', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const driveClient = getDriveClient(context.connection);

    // Drive files.create, NEVER Docs documents.create: the latter has no parents param,
    // always lands in the caller's My Drive, and 403s for 0-quota service accounts.
    const response = await driveClient.files.create({
        requestBody: {
            name: args.name,
            mimeType: GOOGLE_DOC_MIME_TYPE,
            parents: [args.folderId],
        },
        fields: 'id, name, webViewLink',
        supportsAllDrives: true,
    });

    return { documentId: response.data.id, name: response.data.name, webViewLink: response.data.webViewLink };
});

global.registerAction('googledocs/documents-insert-image', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const docsClient = getDocsClient(context.connection);

    await docsClient.documents.batchUpdate({
        documentId: args.documentId,
        requestBody: {
            requests: [{ insertInlineImage: { endOfSegmentLocation: {}, uri: args.imageUrl } }],
        },
    });

    return { documentId: args.documentId };
});
