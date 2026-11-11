import { createSegmentClient } from './segment.utils.ts';

global.registerAction('segment/identify', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const analytics = createSegmentClient(context.connection);

    return analytics.identify({
        userId: args.userId,
        anonymousId: args.anonymousId,
        traits: args.traits,
        timestamp: args.timestamp,
        context: args.context,
        integrations: args.integrations,
        messageId: args.messageId,
    });
});

global.registerAction('segment/track', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const analytics = createSegmentClient(context.connection);

    return analytics.track({
        userId: args.userId,
        anonymousId: args.anonymousId,
        event: args.event,
        properties: args.properties,
        timestamp: args.timestamp,
        context: args.context,
        integrations: args.integrations,
        messageId: args.messageId,
    });
});

global.registerAction('segment/group', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const analytics = createSegmentClient(context.connection);

    return analytics.group({
        userId: args.userId,
        anonymousId: args.anonymousId,
        groupId: args.groupId,
        traits: args.traits,
        timestamp: args.timestamp,
        context: args.context,
        integrations: args.integrations,
        messageId: args.messageId,
    });
});

global.registerAction('segment/page', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const analytics = createSegmentClient(context.connection);

    return analytics.page({
        userId: args.userId,
        anonymousId: args.anonymousId,
        name: args.name,
        category: args.category,
        properties: args.properties,
        timestamp: args.timestamp,
        context: args.context,
        integrations: args.integrations,
        messageId: args.messageId,
    });
});

global.registerAction('segment/alias', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const analytics = createSegmentClient(context.connection);

    return analytics.alias({
        previousId: args.previousId,
        userId: args.userId,
        timestamp: args.timestamp,
        context: args.context,
        integrations: args.integrations,
        messageId: args.messageId,
    });
});

global.registerAction('segment/screen', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const analytics = createSegmentClient(context.connection);

    return analytics.screen({
        userId: args.userId,
        anonymousId: args.anonymousId,
        name: args.name,
        category: args.category,
        properties: args.properties,
        timestamp: args.timestamp,
        context: args.context,
        integrations: args.integrations,
        messageId: args.messageId,
    });
});
