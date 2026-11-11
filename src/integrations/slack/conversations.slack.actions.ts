import { WebClient } from '@slack/web-api';

global.registerAction('slack/conversations-list', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = new WebClient(context.connection?.botToken);

    return await client.conversations.list({
        exclude_archived: args.exclude_archived,
        limit: args.limit,
        types: (args.types || ['public_channel']).join(','),
        cursor: args.cursor,
        team_id: args.team_id,
    });
});

global.registerAction('slack/conversations-history', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = new WebClient(context.connection?.botToken);

    if (['dm', 'mpim'].includes(args._destination_type)) {
        const openResponse = await client.conversations.open({
            users: args.users.join(','),
        });
        args.channel = openResponse.channel.id;
    }

    return await client.conversations.history({
        channel: args.channel,
        limit: args.limit,
        oldest: args.oldest,
        latest: args.latest,
        inclusive: args.inclusive,
        cursor: args.cursor,
    });
});
