import type { Context as HonoContext } from 'hono';
import triggerCore from '../../core/trigger.core.js';
import CONNECTIONS from '../../data/connections.json' with { type: 'json' };
import { isEditorRuntimeEnabled } from '../../services/editorRuntime.service.ts';
import { getWebhookConfig, registerWebhook } from '../../services/webhook.service.ts';

const telegramConnections = Object.values(CONNECTIONS as { [key: string]: any }).filter(
    c => c.integration === 'telegram'
);
for (const connection of telegramConnections) {
    const isWebhookEnabled = process.env[connection.config?.webhookEnabled?.__envVariableKey] === 'TRUE';
    if (!isWebhookEnabled) continue;
    const path = process.env[connection.config?.webhookPath?.__envVariableKey];
    if (!path) continue;
    const webhookSecretKey = process.env[connection.config?.webhookSecretKey?.__envVariableKey];
    if (!isEditorRuntimeEnabled() && !webhookSecretKey) continue;
    const startupConfig = { webhookEnabled: 'TRUE', webhookPath: path, webhookSecretKey };

    registerWebhook('POST', path, async (c: HonoContext) => {
        const { webhookSecretKey } = getWebhookConfig(connection, startupConfig) || {};
        if (!webhookSecretKey) return;

        if (c.req.header('x-telegram-bot-api-secret-token') !== webhookSecretKey) return c.json({}, 400);

        const update = await c.req.json();
        const triggerOptions = {
            socketId: c.req.header('ww-socket-id'),
            editorUserId: c.req.header('ww-editor-user-id'),
            honoContext: c,
        };
        if (update?.message) {
            await triggerCore.execute('telegram/message', update.message, triggerOptions);
        } else if (update?.callback_query) {
            await triggerCore.execute('telegram/callback-query', update.callback_query, triggerOptions);
        } else {
            return c.json({ ignored: true }, 200);
        }

        return c.json({}, 200);
    });
}
