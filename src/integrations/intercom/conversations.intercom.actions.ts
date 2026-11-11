import { getIntercomClient, buildSearchQuery, buildPagination, assertFlatEventMetadata } from './intercom.utils.ts';

global.registerAction('intercom/send-message', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getIntercomClient(context.connection);

    return await client.messages.create({
        message_type: args.message_type,
        subject: args.subject,
        body: args.body,
        template: args.template,
        from: { type: 'admin', id: args.from_admin_id },
        to: { type: args.to_type, id: args.to_id },
        create_conversation_without_contact_reply: args.create_conversation_without_contact_reply,
    });
});

global.registerAction('intercom/conversations-search', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getIntercomClient(context.connection);

    const page = await client.conversations.search({
        query: buildSearchQuery(args),
        pagination: buildPagination(args),
    });
    return page.response;
});

global.registerAction(
    'intercom/conversations-retrieve',
    async ({ args = {} }: ActionParams, context: ActionContext) => {
        const client = getIntercomClient(context.connection);

        return await client.conversations.find({
            conversation_id: args.id,
            display_as: args.display_as,
        });
    }
);

global.registerAction('intercom/conversations-reply', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getIntercomClient(context.connection);

    const body =
        args.reply_as === 'contact'
            ? {
                  message_type: 'comment' as const,
                  type: 'user' as const,
                  intercom_user_id: args.contact_id,
                  body: args.body,
                  attachment_urls: args.attachment_urls,
              }
            : {
                  message_type: (args.message_type ?? 'comment') as 'comment' | 'note',
                  type: 'admin' as const,
                  admin_id: args.admin_id,
                  body: args.body,
                  attachment_urls: args.attachment_urls,
              };

    return await client.conversations.reply({
        conversation_id: args.id,
        body,
    });
});

global.registerAction('intercom/conversations-manage', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getIntercomClient(context.connection);

    let body;
    if (args.mode === 'close') {
        body = { message_type: 'close' as const, type: 'admin' as const, admin_id: args.admin_id, body: args.body };
    } else if (args.mode === 'snooze') {
        body = {
            message_type: 'snoozed' as const,
            admin_id: args.admin_id,
            snoozed_until: args.snoozed_until,
        };
    } else if (args.mode === 'open') {
        body = { message_type: 'open' as const, admin_id: args.admin_id };
    } else {
        body = {
            message_type: 'assignment' as const,
            type: (args.assignee_type ?? 'admin') as 'admin' | 'team',
            admin_id: args.admin_id,
            assignee_id: args.assignee_id,
        };
    }

    return await client.conversations.manage({
        conversation_id: args.id,
        body,
    });
});

global.registerAction('intercom/conversations-create', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getIntercomClient(context.connection);

    return await client.conversations.create({
        from: { type: args.from_type, id: args.from_id },
        body: args.body,
    });
});

global.registerAction('intercom/track-event', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getIntercomClient(context.connection);

    // POST /events returns 202 with an empty body; surface an explicit ack instead of undefined.
    // Intercom does NOT validate metadata and silently drops bad shapes, so check before sending.
    assertFlatEventMetadata(args.metadata);
    await client.events.create({
        event_name: args.event_name,
        created_at: args.created_at ?? Math.floor(Date.now() / 1000),
        id: args.contact_id,
        user_id: args.user_id,
        email: args.email,
        metadata: args.metadata,
    });
    return { accepted: true };
});

global.registerAction('intercom/tags-create', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getIntercomClient(context.connection);

    return await client.tags.create({ name: args.name });
});
