import { createRemoteJWKSet, jwtVerify } from 'jose';

// createRemoteJWKSet caches and re-fetches the JWKS on its own; keep one instance per tenant.
const jwksByDomain = new Map();

function getTenantJwks(domain) {
    if (!jwksByDomain.has(domain)) {
        jwksByDomain.set(domain, createRemoteJWKSet(new URL(`https://${domain}/.well-known/jwks.json`)));
    }
    return jwksByDomain.get(domain);
}

export const auth0AuthRefreshHook = async (c, { session, connection } = {}) => {
    if (!session?.id_token) return;

    const rawDomain = connection?.config?.customDomain || connection?.config?.domain;
    if (!rawDomain) throw new Error('Auth0 domain is missing from the connection config');
    const domain = String(rawDomain)
        .replace(/^https?:\/\//, '')
        .replace(/\/+$/, '');

    // Without this, any JWT signed by the tenant opens a session: an id_token issued for another
    // application of the same tenant, or an access token meant for one of its APIs.
    const audience = connection?.config?.SPAClientId;

    // exp is deliberately tolerated: expiry was never enforced on this path and the session
    // cookie stays the lifetime authority. A bad signature still throws, which makes the
    // session middleware drop the session.
    const { payload } = await jwtVerify(session.id_token, getTenantJwks(domain), {
        algorithms: ['RS256'],
        clockTolerance: '10 years',
        ...(audience ? { audience } : {}),
    });

    c.set('user', payload);
};

global.registerHook('auth-refresh', 'integration:auth0', auth0AuthRefreshHook);
