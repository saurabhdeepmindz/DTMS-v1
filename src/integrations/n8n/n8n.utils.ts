function trimTrailingSlash(url: any) {
    return String(url || '').replace(/\/+$/, '');
}

// API base = {baseUrl}/api/v1 — every public API call goes through here with the API key header.
export function getApiBase(connection?: ConnectionConfig) {
    // A missing/unresolved connection (e.g. an unknown connectionId on the action) would otherwise
    // surface as a raw "Failed to parse URL" TypeError from fetch.
    if (!connection?.baseUrl) {
        throw {
            status: 400,
            message:
                'The n8n connection is missing or not configured (no base URL) — check the connection selected on the action.',
        };
    }
    return `${trimTrailingSlash(connection.baseUrl)}/api/v1`;
}

export function getApiHeaders(connection?: ConnectionConfig) {
    return {
        'X-N8N-API-KEY': connection?.apiKey,
        Accept: 'application/json',
    };
}

// Webhook base = {webhookBaseUrl || baseUrl} — self-hosted instances can serve webhooks from a
// different host (WEBHOOK_URL env override). Webhook calls do NOT send the API key header.
export function getWebhookBase(connection?: ConnectionConfig) {
    return trimTrailingSlash(connection?.webhookBaseUrl || connection?.baseUrl);
}

// Clamp a user-provided page size to n8n's 1..250 bounds; undefined (API default) when unusable.
export function clampLimit(value: any): number | undefined {
    const limit = Number(value);
    if (!Number.isFinite(limit) || limit < 1) return undefined;
    return Math.min(Math.floor(limit), 250);
}

export function buildQueryString(params: Record<string, any>) {
    if (!params || Object.keys(params).length === 0) return '';

    const queryParts = Object.entries(params)
        .filter(([, value]) => value !== undefined && value !== null && value !== '')
        .filter(([, value]) => !(typeof value === 'number' && !Number.isFinite(value)))
        // Objects/arrays would stringify to "[object Object]" — send them as JSON instead
        .map(([key, value]) => `${key}=${encodeURIComponent(typeof value === 'object' ? JSON.stringify(value) : value)}`)
        .join('&');

    return queryParts ? `?${queryParts}` : '';
}
