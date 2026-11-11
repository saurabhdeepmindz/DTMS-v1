import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Context as HonoContext } from 'hono';
import triggerCore from '../../core/trigger.core.js';
import CONNECTIONS from '../../data/connections.json' with { type: 'json' };
import { isEditorRuntimeEnabled } from '../../services/editorRuntime.service.ts';
import { getWebhookConfig, registerWebhook } from '../../services/webhook.service.ts';

function isValidSignature(rawBody: string, signatureHeader: string | undefined, appSecret: string): boolean {
    if (!signatureHeader?.startsWith('sha256=')) return false;
    const expected = createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex');
    const received = signatureHeader.slice('sha256='.length);
    if (received.length !== expected.length) return false;
    return timingSafeEqual(Buffer.from(received, 'utf8'), Buffer.from(expected, 'utf8'));
}

const whatsappConnections = Object.values(CONNECTIONS as { [key: string]: any }).filter(
    c => c.integration === 'whatsapp'
);
for (const connection of whatsappConnections) {
    const isWebhookEnabled = process.env[connection.config?.webhookEnabled?.__envVariableKey] === 'TRUE';
    if (!isWebhookEnabled) continue;
    const path = process.env[connection.config?.webhookPath?.__envVariableKey];
    if (!path) continue;
    const appSecret = process.env[connection.config?.appSecret?.__envVariableKey];
    if (!isEditorRuntimeEnabled() && !appSecret) continue;
    const verifyToken = process.env[connection.config?.verifyToken?.__envVariableKey];
    if (!isEditorRuntimeEnabled() && !verifyToken) continue;
    const startupConfig = { webhookEnabled: 'TRUE', webhookPath: path, appSecret, verifyToken };

    // Meta's subscription handshake: echo hub.challenge as plain text when the verify token matches.
    registerWebhook('GET', path, async (c: HonoContext) => {
        const { verifyToken } = getWebhookConfig(connection, startupConfig) || {};
        if (!verifyToken) return;

        const mode = c.req.query('hub.mode');
        const token = c.req.query('hub.verify_token');
        const challenge = c.req.query('hub.challenge');
        if (mode !== 'subscribe' || token !== verifyToken || !challenge) return c.json({}, 403);
        return c.text(challenge, 200);
    });

    registerWebhook('POST', path, async (c: HonoContext) => {
        const { appSecret } = getWebhookConfig(connection, startupConfig) || {};
        if (!appSecret) return;

        const rawBody = await c.req.text();
        if (!isValidSignature(rawBody, c.req.header('x-hub-signature-256'), appSecret)) return c.json({}, 400);

        let body: any;
        try {
            body = JSON.parse(rawBody);
        } catch {
            return c.json({}, 400);
        }
        if (body?.object !== 'whatsapp_business_account') return c.json({ ignored: true }, 200);

        const triggerContext = {
            socketId: c.req.header('ww-socket-id'),
            editorUserId: c.req.header('ww-editor-user-id'),
            honoContext: c,
        };

        for (const entry of body.entry || []) {
            for (const change of entry.changes || []) {
                if (change.field !== 'messages') continue;
                const value = change.value || {};
                const phoneNumberId = value.metadata?.phone_number_id;

                for (const message of value.messages || []) {
                    const contact = (value.contacts || []).find((ct: any) => ct.wa_id === message.from);
                    await triggerCore.execute(
                        'whatsapp/message-received',
                        {
                            messageId: message.id,
                            from: message.from,
                            senderName: contact?.profile?.name,
                            timestamp: message.timestamp,
                            type: message.type,
                            text: message.text?.body,
                            phoneNumberId,
                            raw: message,
                        },
                        triggerContext
                    );
                }

                for (const status of value.statuses || []) {
                    await triggerCore.execute(
                        'whatsapp/message-status-updated',
                        {
                            messageId: status.id,
                            status: status.status,
                            timestamp: status.timestamp,
                            recipientId: status.recipient_id,
                            errors: status.errors,
                            phoneNumberId,
                            raw: status,
                        },
                        triggerContext
                    );
                }
            }
        }

        return c.json({}, 200);
    });
}
