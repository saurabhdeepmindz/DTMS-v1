import { getClient, serialize, toTwilioError } from './twilio.utils.ts';

global.registerAction('twilio/messages-send', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getClient(context.connection);

    try {
        const message = await client.messages.create({
            to: args.to,
            from: args.from,
            messagingServiceSid: args.messagingServiceSid,
            body: args.body,
            mediaUrl: args.mediaUrl,
            statusCallback: args.statusCallback,
        });

        return serialize(message);
    } catch (error) {
        throw toTwilioError(error);
    }
});

global.registerAction('twilio/messages-fetch', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getClient(context.connection);

    const message = await client.messages(args.messageSid).fetch();

    return serialize(message);
});

global.registerAction('twilio/messages-list', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getClient(context.connection);

    const messages = await client.messages.list({
        to: args.to,
        from: args.from,
        dateSent: args.dateSent ? new Date(args.dateSent) : undefined,
        limit: args.limit ?? 50,
    });

    return messages.map(serialize);
});
