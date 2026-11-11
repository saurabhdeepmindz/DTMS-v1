import { SendEmailRequest, SendPushRequest } from 'customerio-node';
import { createAPIClient } from './customerio.utils.ts';

global.registerAction('customerio/app-send-email', async ({ args }: ActionParams, context: ActionContext) => {
    const api = createAPIClient(context.connection);

    const emailRequest = new SendEmailRequest({
        to: args.to,
        identifiers: args.identifiers,
        transactional_message_id: args.transactional_message_id,
        from: args.from,
        subject: args.subject,
        body: args.body,
        body_plain: args.body_plain,
        body_amp: args.body_amp,
        reply_to: args.reply_to,
        bcc: args.bcc,
        headers: args.headers,
        preheader: args.preheader,
        message_data: args.message_data,
        disable_message_retention: args.disable_message_retention,
        send_to_unsubscribed: args.send_to_unsubscribed,
        tracked: args.tracked,
        queue_draft: args.queue_draft,
        send_at: args.send_at,
        disable_css_preprocessing: args.disable_css_preprocessing,
        language: args.language,
        fake_bcc: args.fake_bcc,
    });

    return await api.sendEmail(emailRequest);
});

global.registerAction('customerio/app-send-push', async ({ args }: ActionParams, context: ActionContext) => {
    const api = createAPIClient(context.connection);

    const pushRequest = new SendPushRequest({
        identifiers: args.identifiers,
        transactional_message_id: args.transactional_message_id,
        to: args.to,
        title: args.title,
        message: args.message,
        link: args.link,
        image_url: args.image_url,
        message_data: args.message_data,
        custom_data: args.custom_data,
        custom_payload: args.custom_payload,
        device: args.device,
        custom_device: args.custom_device,
        sound: args.sound,
        language: args.language,
        send_at: args.send_at,
        disable_message_retention: args.disable_message_retention,
        send_to_unsubscribed: args.send_to_unsubscribed,
        queue_draft: args.queue_draft,
    });

    return await api.sendPush(pushRequest);
});
