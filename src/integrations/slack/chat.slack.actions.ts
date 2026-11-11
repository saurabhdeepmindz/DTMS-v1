import { WebClient } from '@slack/web-api';

global.registerAction('slack/chat-post-message', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = new WebClient(context.connection?.botToken);

    if (['dm', 'mpim'].includes(args._destination_type)) {
        const openResponse = await client.conversations.open({
            users: args.users.join(','),
        });
        args.channel = openResponse.channel.id;
    }

    return await client.chat.postMessage({
        channel: args.channel,
        text: args.text,
        blocks: args.blocks,
        attachments: args.attachments,
        thread_ts: args.thread_ts,
        reply_broadcast: args.reply_broadcast,
        parse: args.parse,
        unfurl_links: args.unfurl_links,
        unfurl_media: args.unfurl_media,
        icon_url: args.icon_url,
        username: args.username,
        metadata: args.metadata && Object.keys(args.metadata).length ? args.metadata : undefined,
    });
});
