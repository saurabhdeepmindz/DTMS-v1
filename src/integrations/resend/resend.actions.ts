import { Resend } from 'resend';
import { transformFileAttachments } from '../utils.ts';

global.registerAction('resend/emails-send', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const apiKey = context.connection?.apiKey;
    if (!apiKey) {
        // Without this guard the Resend SDK falls back to process.env.RESEND_API_KEY and sends on the wrong account
        throw {
            statusCode: 401,
            name: 'validation_error',
            message: 'No API key found on the Resend connection — check the connection selected on this action.',
        };
    }
    const resend = new Resend(apiKey);

    if (args.attachments) {
        args.attachments = await transformFileAttachments(args.attachments, 'content');
    }
    const { data, error } = await resend.emails.send({
        from: args.from,
        to: args.to,
        subject: args.subject,
        html: args.html,
        text: args.text,
        replyTo: args.replyTo,
        bcc: args.bcc,
        cc: args.cc,
        tags: args.tags,
        attachments: args.attachments,
    });

    if (error) throw error;
    return data;
});
