const GRAPH_VERSION = 'v23.0';
export const API_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

export function getHeaders(connection?: ConnectionConfig) {
    // A missing/unresolved connection would otherwise surface as an opaque 401 from Meta.
    if (!connection?.accessToken) {
        throw {
            status: 400,
            message:
                'The WhatsApp connection is missing or not configured (no access token) — check the connection selected on the action.',
        };
    }
    return {
        Authorization: `Bearer ${connection.accessToken}`,
        'Content-Type': 'application/json',
    };
}

export function getPhoneNumberId(connection?: ConnectionConfig): string {
    if (!connection?.phoneNumberId) {
        throw {
            status: 400,
            message:
                'The WhatsApp connection has no Phone Number ID configured (App Dashboard → WhatsApp → API Setup) — check the connection selected on the action.',
        };
    }
    return connection.phoneNumberId;
}

export function getBusinessAccountId(connection?: ConnectionConfig): string {
    if (!connection?.businessAccountId) {
        throw {
            status: 400,
            message:
                'The WhatsApp connection has no Business Account ID (WABA ID) configured (App Dashboard → WhatsApp → API Setup) — check the connection selected on the action.',
        };
    }
    return connection.businessAccountId;
}

// Every send action posts to the same endpoint; Meta always expects messaging_product: 'whatsapp'.
export async function postMessage(connection: ConnectionConfig | undefined, payload: Record<string, any>) {
    // Check the token before the phone number id: a missing/unknown connection should surface as
    // "connection missing — check the connection selected", not as a misconfigured Phone Number ID.
    const headers = getHeaders(connection);
    const response = await fetch(`${API_BASE}/${encodeURIComponent(getPhoneNumberId(connection))}/messages`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ messaging_product: 'whatsapp', ...payload }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw data;
    return data;
}

export function buildQueryString(params: Record<string, any>) {
    if (!params || Object.keys(params).length === 0) return '';

    const queryParts = Object.entries(params)
        .filter(([, value]) => value !== undefined && value !== null && value !== '')
        .map(([key, value]) => `${key}=${encodeURIComponent(typeof value === 'object' ? JSON.stringify(value) : value)}`)
        .join('&');

    return queryParts ? `?${queryParts}` : '';
}

// Clamp a user-provided page size to the Graph API's 1..100 bounds; undefined (API default) when unusable.
export function clampLimit(value: any): number | undefined {
    const limit = Number(value);
    if (!Number.isFinite(limit) || limit < 1) return undefined;
    return Math.min(Math.floor(limit), 100);
}
