import {
    configureCloudinary,
    contextToSignedString,
    eagerToSignedString,
    throwSanitizedAdminError,
    transformationToSignedString,
} from './cloudinary.utils.ts';
import { fileToDataURI } from '../utils.ts';

global.registerAction('cloudinary/api-resources', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const cloudinary = configureCloudinary(context.connection);

    try {
        return await cloudinary.api.resources({
            resource_type: args.resource_type,
            // Cloudinary requires type as soon as prefix is used; apply the documented default
            type: args.type ?? 'upload',
            max_results: args.max_results,
            next_cursor: args.next_cursor,
            prefix: args.prefix,
            tags: args.tags,
            context: args.context,
            moderations: args.moderations,
            start_at: args.start_at,
            direction: args.direction,
            fields: args.fields,
            metadata: args.metadata,
        });
    } catch (err) {
        throwSanitizedAdminError(err);
    }
});

global.registerAction('cloudinary/api-resource', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const cloudinary = configureCloudinary(context.connection);

    try {
        return await cloudinary.api.resource(args.public_id, {
            resource_type: args.resource_type,
            type: args.type,
        });
    } catch (err) {
        throwSanitizedAdminError(err);
    }
});

global.registerAction('cloudinary/uploader-upload', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const cloudinary = configureCloudinary(context.connection);

    if (args.file instanceof File) {
        args.file = await fileToDataURI(args.file);
    }
    return await cloudinary.uploader.upload(args.file, {
        public_id: args.public_id,
        folder: args.folder,
        tags: args.tags,
        context: args.context,
        resource_type: args.resource_type,
        type: args.type,
        overwrite: args.overwrite,
        unique_filename: args.unique_filename,
        use_filename: args.use_filename,
        moderation: args.moderation,
    });
});

global.registerAction('cloudinary/uploader-explicit', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const cloudinary = configureCloudinary(context.connection);

    return await cloudinary.uploader.explicit(args.public_id, {
        tags: args.tags,
        context: args.context,
        resource_type: args.resource_type,
        type: args.type,
    });
});

global.registerAction('cloudinary/api-update', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const cloudinary = configureCloudinary(context.connection);

    try {
        return await cloudinary.api.update(args.public_id, {
            resource_type: args.resource_type,
            type: args.type,
            tags: args.tags,
            context: args.context,
            moderation_status: args.moderation_status,
        });
    } catch (err) {
        throwSanitizedAdminError(err);
    }
});

global.registerAction('cloudinary/uploader-destroy', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const cloudinary = configureCloudinary(context.connection);

    return await cloudinary.uploader.destroy(args.public_id, {
        resource_type: args.resource_type,
        type: args.type,
        invalidate: args.invalidate,
    });
});

global.registerAction('cloudinary/url', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const cloudinary = configureCloudinary(context.connection);

    return cloudinary.url(args.public_id, {
        resource_type: args.resource_type,
        secure: args.secure,
        format: args.format,
        transformation: args.transformation,
        analytics: false,
    });
});

global.registerAction('cloudinary/private-download-url', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const cloudinary = configureCloudinary(context.connection);

    return cloudinary.utils.private_download_url(args.public_id, args.format, {
        resource_type: args.resource_type,
        type: args.type,
        expires_at: args.expires_at,
        attachment: args.attachment,
    });
});

global.registerAction('cloudinary/api-sign-request', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const cloudinary = configureCloudinary(context.connection);

    return cloudinary.utils.api_sign_request(
        {
            folder: args.folder,
            public_id: args.public_id,
            tags: args.tags,
            eager: eagerToSignedString(args.eager),
            moderation: args.moderation,
            notification_url: args.notification_url,
            context: contextToSignedString(args.context),
            timestamp: args.timestamp,
            transformation: transformationToSignedString(args.transformation),
            upload_preset: args.upload_preset,
        },
        cloudinary.config().api_secret
    );
});
