import { callTelegram } from './telegram.utils.ts';

global.registerAction('telegram/send-message', async ({ args = {} }: ActionParams, context: ActionContext) => {
    return await callTelegram(context.connection?.botToken, 'sendMessage', {
        chat_id: args.chat_id,
        text: args.text,
        parse_mode: args.parse_mode,
        disable_notification: args.disable_notification,
        protect_content: args.protect_content,
        reply_parameters: args.reply_to_message_id ? { message_id: args.reply_to_message_id } : undefined,
        reply_markup: args.reply_markup && Object.keys(args.reply_markup).length ? args.reply_markup : undefined,
    });
});

global.registerAction('telegram/send-photo', async ({ args = {} }: ActionParams, context: ActionContext) => {
    return await callTelegram(context.connection?.botToken, 'sendPhoto', {
        chat_id: args.chat_id,
        photo: args.photo,
        caption: args.caption,
        parse_mode: args.parse_mode,
        disable_notification: args.disable_notification,
        protect_content: args.protect_content,
        reply_parameters: args.reply_to_message_id ? { message_id: args.reply_to_message_id } : undefined,
        reply_markup: args.reply_markup && Object.keys(args.reply_markup).length ? args.reply_markup : undefined,
    });
});

global.registerAction('telegram/send-document', async ({ args = {} }: ActionParams, context: ActionContext) => {
    return await callTelegram(context.connection?.botToken, 'sendDocument', {
        chat_id: args.chat_id,
        document: args.document,
        caption: args.caption,
        parse_mode: args.parse_mode,
        disable_notification: args.disable_notification,
        protect_content: args.protect_content,
        reply_parameters: args.reply_to_message_id ? { message_id: args.reply_to_message_id } : undefined,
        reply_markup: args.reply_markup && Object.keys(args.reply_markup).length ? args.reply_markup : undefined,
    });
});

global.registerAction('telegram/edit-message-text', async ({ args = {} }: ActionParams, context: ActionContext) => {
    return await callTelegram(context.connection?.botToken, 'editMessageText', {
        chat_id: args.chat_id,
        message_id: args.message_id,
        text: args.text,
        parse_mode: args.parse_mode,
        reply_markup: args.reply_markup && Object.keys(args.reply_markup).length ? args.reply_markup : undefined,
    });
});

global.registerAction('telegram/delete-message', async ({ args = {} }: ActionParams, context: ActionContext) => {
    return await callTelegram(context.connection?.botToken, 'deleteMessage', {
        chat_id: args.chat_id,
        message_id: args.message_id,
    });
});

global.registerAction('telegram/get-chat', async ({ args = {} }: ActionParams, context: ActionContext) => {
    return await callTelegram(context.connection?.botToken, 'getChat', {
        chat_id: args.chat_id,
    });
});

global.registerAction('telegram/answer-callback-query', async ({ args = {} }: ActionParams, context: ActionContext) => {
    return await callTelegram(context.connection?.botToken, 'answerCallbackQuery', {
        callback_query_id: args.callback_query_id,
        text: args.text,
        show_alert: args.show_alert,
        cache_time: args.cache_time,
    });
});
