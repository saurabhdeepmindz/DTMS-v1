import { getClient, serialize, toTwilioError } from './twilio.utils.ts';

global.registerAction('twilio/calls-create', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getClient(context.connection);

    try {
        const call = await client.calls.create({
            to: args.to,
            from: args.from,
            url: args.url,
            twiml: args.twiml,
            method: args.method,
            statusCallback: args.statusCallback,
        });

        return serialize(call);
    } catch (error) {
        throw toTwilioError(error);
    }
});

global.registerAction('twilio/calls-fetch', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getClient(context.connection);

    const call = await client.calls(args.callSid).fetch();

    return serialize(call);
});

global.registerAction('twilio/calls-list', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getClient(context.connection);

    const calls = await client.calls.list({
        to: args.to,
        from: args.from,
        status: args.status,
        startTime: args.startTime ? new Date(args.startTime) : undefined,
        limit: args.limit ?? 50,
    });

    return calls.map(serialize);
});

global.registerAction('twilio/calls-update', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getClient(context.connection);

    const call = await client.calls(args.callSid).update({
        status: args.status,
        url: args.url,
        twiml: args.twiml,
        method: args.method,
    });

    return serialize(call);
});
