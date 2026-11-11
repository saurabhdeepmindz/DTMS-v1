import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Context as HonoContext } from 'hono';
import triggerCore from '../../core/trigger.core.js';
import CONNECTIONS from '../../data/connections.json' with { type: 'json' };
import { isEditorRuntimeEnabled } from '../../services/editorRuntime.service.ts';
import { getWebhookConfig, registerWebhook } from '../../services/webhook.service.ts';

// Intercom webhook topics exposed as triggers. Subscriptions cannot be created via the
// Intercom API — the builder pastes this route's URL into Developer Hub and ticks topics.
const TOPICS_AVAILABLE = [
    'contact.user.created',
    'contact.lead.created',
    'conversation.user.created',
    'conversation.user.replied',
    'conversation.admin.replied',
    'conversation.admin.closed',
    'conversation.rating.added',
    'ticket.created',
    'ticket.state.updated',
];

function verifySignature(body: string, header: string | undefined, secret: string): boolean {
    if (!header || !header.startsWith('sha1=')) return false;
    const expected = createHmac('sha1', secret).update(body).digest('hex');
    const received = header.slice('sha1='.length);
    if (received.length !== expected.length) return false;
    return timingSafeEqual(Buffer.from(received, 'hex'), Buffer.from(expected, 'hex'));
}

const intercomConnections = Object.values(CONNECTIONS as { [key: string]: any }).filter(
    c => c.integration === 'intercom'
);
for (const connection of intercomConnections) {
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

        const rawBody = await c.req.text();
        if (!verifySignature(rawBody, c.req.header('x-hub-signature'), webhookSecretKey)) {
            return c.json({}, 400);
        }

        const notification = JSON.parse(rawBody);

        // Intercom sends a ping on subscription setup — acknowledge without firing.
        if (notification.topic === 'ping') return c.json({ pong: true }, 200);

        if (!TOPICS_AVAILABLE.includes(notification.topic)) return c.json({ ignored: true }, 200);

        await triggerCore.execute(
            `intercom/${notification.topic}`,
            { ...notification.data?.item, topic: notification.topic },
            {
                socketId: c.req.header('ww-socket-id'),
                editorUserId: c.req.header('ww-editor-user-id'),
                honoContext: c,
            }
        );

        return c.json({}, 200);
    });
}
