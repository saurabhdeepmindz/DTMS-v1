import OpenAI from 'openai';

global.registerAction('openai/conversations-create', async ({ args }: ActionParams, context: ActionContext) => {
    const openai = new OpenAI({ apiKey: context.connection?.apiKey });

    return await openai.conversations.create({
        items: args.items,
        metadata: args.metadata,
    });
});

global.registerAction('openai/conversations-retrieve', async ({ args }: ActionParams, context: ActionContext) => {
    const openai = new OpenAI({ apiKey: context.connection?.apiKey });

    return await openai.conversations.retrieve(args.conversation_id);
});

global.registerAction('openai/conversations-update', async ({ args }: ActionParams, context: ActionContext) => {
    const openai = new OpenAI({ apiKey: context.connection?.apiKey });

    return await openai.conversations.update(args.conversation_id, {
        metadata: args.metadata,
    });
});

global.registerAction('openai/conversations-delete', async ({ args }: ActionParams, context: ActionContext) => {
    const openai = new OpenAI({ apiKey: context.connection?.apiKey });

    return await openai.conversations.delete(args.conversation_id);
});

global.registerAction('openai/conversations-items-list', async ({ args }: ActionParams, context: ActionContext) => {
    const openai = new OpenAI({ apiKey: context.connection?.apiKey });

    return await openai.conversations.items.list(args.conversation_id, {
        after: args.after,
        include: args.include,
        limit: args.limit,
        order: args.order,
    });
});

global.registerAction('openai/conversations-items-create', async ({ args }: ActionParams, context: ActionContext) => {
    const openai = new OpenAI({ apiKey: context.connection?.apiKey });

    return await openai.conversations.items.create(args.conversation_id, {
        include: args.include,
        items: args.items,
    });
});

global.registerAction('openai/conversations-items-retrieve', async ({ args }: ActionParams, context: ActionContext) => {
    const openai = new OpenAI({ apiKey: context.connection?.apiKey });

    return await openai.conversations.items.retrieve(args.item_id, {
        conversation_id: args.conversation_id,
        include: args.include,
    });
});

global.registerAction('openai/conversations-items-delete', async ({ args }: ActionParams, context: ActionContext) => {
    const openai = new OpenAI({ apiKey: context.connection?.apiKey });

    return await openai.conversations.items.delete(args.item_id, {
        conversation_id: args.conversation_id,
    });
});
