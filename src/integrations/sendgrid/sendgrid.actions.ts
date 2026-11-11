import sgMail from '@sendgrid/mail';
import { transformFileAttachments } from '../utils.ts';

global.registerAction('sendgrid/mail-send', async ({ args = {} }: ActionParams, context: ActionContext) => {
    try {
        sgMail.setApiKey(context.connection?.apiKey);

        if (args.attachments) {
            args.attachments = await transformFileAttachments(args.attachments, 'content');
        }
        // Build SendGrid content array from editor fields
        let content = args.content;
        if (!content || (Array.isArray(content) && content.length === 0)) {
            if (args._contentType === 'html') {
                content = [];
                if (args._textContent) content.push({ value: args._textContent, type: 'text/plain' });
                if (args._htmlContent) content.push({ value: args._htmlContent, type: 'text/html' });
            } else if (args._textContent) {
                content = [{ value: args._textContent, type: 'text/plain' }];
            }
        }

        const [response] = await sgMail.send({
            to: args.to,
            from: args.from,
            replyTo: args.replyTo?.email ? args.replyTo : undefined,
            subject: args.subject,
            content,
            attachments: args.attachments,
            categories: args.categories,
            cc: args.cc?.length ? args.cc : undefined,
            bcc: args.bcc?.length ? args.bcc : undefined,
        });

        return response;
    } catch (err) {
        throw err?.response?.body?.errors ?? err;
    }
});
