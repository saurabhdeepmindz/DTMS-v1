import postmark from 'postmark';
import { transformFileAttachments } from '../utils.ts';

global.registerAction('postmark/send-email', async ({ args }: ActionParams, context: ActionContext) => {
    const client = new postmark.ServerClient(context.connection.apiKey);

    if (args.Attachments) {
        args.Attachments = await transformFileAttachments(args.Attachments, 'Content');
    }
    return await client.sendEmail({
        From: args.From,
        To: args.To,
        Cc: args.Cc,
        Bcc: args.Bcc,
        Subject: args.Subject,
        Tag: args.Tag,
        TextBody: args.TextBody,
        HtmlBody: args.HtmlBody,
        ReplyTo: args.ReplyTo,
        Headers: args.Headers,
        TrackOpens: args.TrackOpens,
        TrackLinks: args.TrackLinks,
        Metadata: args.Metadata,
        Attachments: args.Attachments,
        MessageStream: args.MessageStream,
    });
});
