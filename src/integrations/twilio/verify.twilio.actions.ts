import { getClient, serialize } from './twilio.utils.ts';

global.registerAction('twilio/verify-start', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getClient(context.connection);

    const verification = await client.verify.v2.services(args.serviceSid).verifications.create({
        to: args.to,
        channel: args.channel,
    });

    return serialize(verification);
});

global.registerAction('twilio/verify-check', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getClient(context.connection);

    const check = await client.verify.v2.services(args.serviceSid).verificationChecks.create({
        to: args.to,
        code: args.code,
    });

    return serialize(check);
});
