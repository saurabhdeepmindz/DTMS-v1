const DISCOVERY_CACHE_TTL_MS = 60 * 60 * 1000;
const discoveryCache = new Map();

async function getDiscovery(issuerUrl) {
    const cached = discoveryCache.get(issuerUrl);
    if (cached && cached.expiresAt > Date.now()) return cached.discovery;

    const discoveryUrl = `${issuerUrl.replace(/\/$/, '')}/.well-known/openid-configuration`;
    const discoveryResponse = await fetch(discoveryUrl);
    if (!discoveryResponse.ok) throw new Error('Discovery URL request failed');
    const discovery = await discoveryResponse.json();

    discoveryCache.set(issuerUrl, { discovery, expiresAt: Date.now() + DISCOVERY_CACHE_TTL_MS });
    return discovery;
}

global.registerHook('auth-refresh', 'integration:openid', async (c, { session, connection } = {}) => {
    if (!session?.accessToken) return;

    const issuerUrl = connection?.config?.issuerUrl;
    if (!issuerUrl) return;

    const discovery = await getDiscovery(issuerUrl);
    if (!discovery.userinfo_endpoint) return;

    const response = await fetch(discovery.userinfo_endpoint, {
        headers: { Authorization: `Bearer ${session.accessToken}` },
    });
    if (!response.ok) throw new Error(`UserInfo request failed: ${response.status}`);

    c.set('user', await response.json());
});
