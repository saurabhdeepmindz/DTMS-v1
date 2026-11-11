import { getEditorRuntime, isEditorRuntimeEnabled } from './editorRuntime.service.ts';
import { resolveConnection } from './connection.service.js';
import type { Context, Hono } from 'hono';

type WebhookConnection = { id: string; integration: string };
type WebhookConfig = Record<string, string | undefined>;
type WebhookHandler = (context: Context) => Promise<Response | undefined>;
type WebhookRoute = { method: 'GET' | 'POST'; path: string; handlers: WebhookHandler[] };
const handlersByRouter = new WeakMap<object, Map<string, WebhookRoute>>();
const finalizedRouters = new WeakSet<object>();

/** Incomplete live connections must not shadow a configured connection on the same webhook path. */
export function registerWebhook(method: 'GET' | 'POST', path: string, handler: WebhookHandler) {
    let routes = handlersByRouter.get(global.public);
    if (!routes) {
        routes = new Map();
        handlersByRouter.set(global.public, routes);
    }
    const key = `${method} ${path}`;
    const existing = routes.get(key);
    if (existing) {
        existing.handlers.push(handler);
        return;
    }
    const candidates = [handler];
    routes.set(key, { method, path, handlers: candidates });
    global.public.on(method, path, async (context, next) => {
        for (const candidate of candidates) {
            const response = await candidate(context);
            if (response) return response;
        }
        return next();
    });
}

/** Fallbacks come after every candidate, including overlapping Hono patterns, and before protected/app routes. */
export function appendWebhookFallbacks(router: Hono) {
    if (finalizedRouters.has(router)) return;
    finalizedRouters.add(router);
    for (const { method, path } of handlersByRouter.get(router)?.values() || []) {
        router.on(method, path, context => context.json({}, method === 'GET' ? 403 : 400));
    }
}

/** Published handlers keep their startup values; editor handlers use only the current request snapshot. */
export function getWebhookConfig(
    connection: WebhookConnection,
    startupConfig: WebhookConfig
): WebhookConfig | undefined {
    if (!isEditorRuntimeEnabled()) return startupConfig;
    const current = getEditorRuntime()?.connections[connection.id];
    if (!current || current.integration !== connection.integration) return undefined;
    const config = resolveConnection(current)?.config;
    // A disabled or moved route stops accepting calls immediately, even before its rebuild finishes.
    if (config?.webhookEnabled !== 'TRUE' || config.webhookPath !== startupConfig.webhookPath) return undefined;
    return config;
}
