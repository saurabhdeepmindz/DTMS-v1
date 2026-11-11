import { postMessage } from './whatsapp.utils.ts';

global.registerAction('whatsapp/send-text', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const payload: Record<string, any> = {
        to: args.to,
        type: 'text',
        text: {
            body: args.body,
            preview_url: args.previewUrl,
        },
    };
    if (args.replyToMessageId) payload.context = { message_id: args.replyToMessageId };

    return await postMessage(context.connection, payload);
});

const MEDIA_TYPES = ['image', 'audio', 'video', 'document', 'sticker'];

global.registerAction('whatsapp/send-media', async ({ args = {} }: ActionParams, context: ActionContext) => {
    if (!MEDIA_TYPES.includes(args.mediaType)) {
        throw {
            status: 400,
            message: `Invalid media type "${args.mediaType}". Valid types are: ${MEDIA_TYPES.join(', ')}.`,
        };
    }

    const media: Record<string, any> = { link: args.link };
    if (args.caption) media.caption = args.caption;
    if (args.filename) media.filename = args.filename;

    const payload: Record<string, any> = {
        to: args.to,
        type: args.mediaType,
        [args.mediaType]: media,
    };
    if (args.replyToMessageId) payload.context = { message_id: args.replyToMessageId };

    return await postMessage(context.connection, payload);
});

global.registerAction('whatsapp/send-template', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const components: Record<string, any>[] = [];
    if (args.headerVariable) {
        components.push({ type: 'header', parameters: [{ type: 'text', text: String(args.headerVariable) }] });
    }
    if (Array.isArray(args.bodyVariables) && args.bodyVariables.length) {
        components.push({
            type: 'body',
            parameters: args.bodyVariables.map((text: any) => ({ type: 'text', text: String(text) })),
        });
    }

    const template: Record<string, any> = {
        name: args.templateName,
        language: { code: args.languageCode },
    };
    if (components.length) template.components = components;

    return await postMessage(context.connection, { to: args.to, type: 'template', template });
});

global.registerAction('whatsapp/send-interactive', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const interactive: Record<string, any> = {
        type: args.interactiveType,
        body: { text: args.bodyText },
    };
    if (args.headerText) interactive.header = { type: 'text', text: args.headerText };
    if (args.footerText) interactive.footer = { text: args.footerText };

    if (args.interactiveType === 'button') {
        interactive.action = {
            buttons: (args.buttons || []).map((button: any) => ({
                type: 'reply',
                reply: { id: button.id, title: button.title },
            })),
        };
    } else if (args.interactiveType === 'list') {
        interactive.action = {
            button: args.listButtonText,
            sections: (args.sections || []).map((section: any) => ({
                title: section.title,
                rows: (section.rows || []).map((row: any) => ({
                    id: row.id,
                    title: row.title,
                    description: row.description,
                })),
            })),
        };
    } else {
        throw {
            status: 400,
            message: `Invalid interactive type "${args.interactiveType}". Valid types are: button, list.`,
        };
    }

    return await postMessage(context.connection, { to: args.to, type: 'interactive', interactive });
});

global.registerAction('whatsapp/send-reaction', async ({ args = {} }: ActionParams, context: ActionContext) => {
    return await postMessage(context.connection, {
        to: args.to,
        type: 'reaction',
        // An empty emoji removes the reaction — Meta's own convention.
        reaction: { message_id: args.messageId, emoji: args.emoji ?? '' },
    });
});

global.registerAction('whatsapp/send-location', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const location: Record<string, any> = {
        latitude: args.latitude,
        longitude: args.longitude,
    };
    if (args.name) location.name = args.name;
    if (args.address) location.address = args.address;

    return await postMessage(context.connection, { to: args.to, type: 'location', location });
});

global.registerAction('whatsapp/send-contacts', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const contacts = (args.contacts || []).map((contact: any) => {
        const mapped: Record<string, any> = {
            name: {
                formatted_name: contact.formattedName,
                first_name: contact.firstName,
                last_name: contact.lastName,
            },
        };
        if (contact.phone) mapped.phones = [{ phone: contact.phone }];
        if (contact.email) mapped.emails = [{ email: contact.email }];
        if (contact.org) mapped.org = { company: contact.org };
        return mapped;
    });

    return await postMessage(context.connection, { to: args.to, type: 'contacts', contacts });
});

global.registerAction('whatsapp/mark-as-read', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const payload: Record<string, any> = {
        status: 'read',
        message_id: args.messageId,
    };
    if (args.showTypingIndicator) payload.typing_indicator = { type: 'text' };

    return await postMessage(context.connection, payload);
});
