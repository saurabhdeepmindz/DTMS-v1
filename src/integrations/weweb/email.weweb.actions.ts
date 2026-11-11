import { MailService } from '@sendgrid/mail';
import { Client } from '@sendgrid/client';
import { randomUUID } from 'node:crypto';
import { transformFileAttachments } from '../utils.ts';

global.registerAction('send-email', async ({ args }: ActionParams, context: ActionContext) => {
    try {
        // Keep native credentials separate from customer SendGrid integrations and concurrent actions.
        const client = new Client();
        client.setApiKey(process.env.WEWEB_EMAIL_API_KEY);
        client.setDataResidency('eu');
        const mail = new MailService();
        mail.setClient(client);

        if (args.attachments) {
            args.attachments = await transformFileAttachments(args.attachments, 'content');
        }
        const emailDomain = process.env.WEWEB_EMAIL_DOMAIN || 'from.weweb-apps.io';
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

        const [response] = await mail.send({
            to: args.to,
            from: {
                email: `${args.from.emailPrefix}@${emailDomain}`,
                name: args.from.name,
            },
            replyTo: args.replyTo?.email ? args.replyTo : undefined,
            subject: args.subject,
            content,
            attachments: args.attachments,
            categories: args.categories,
            // Controlled runtime metadata only: never copy user-supplied custom arguments or email content.
            customArgs: {
                ww_project_id: process.env.WEWEB_PROJECT_ID,
                ww_environment: process.env.ENV || 'editor',
                ww_send_id: randomUUID(),
                ...(context?.workflowDefinition?.id && { ww_workflow_id: context.workflowDefinition.id }),
            },
            cc: args.cc?.length ? args.cc : undefined,
            bcc: args.bcc?.length ? args.bcc : undefined,
        });

        return response;
    } catch (err) {
        throw err?.response?.body?.errors ?? err;
    }
});
