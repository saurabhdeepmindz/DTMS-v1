import triggerCore from '../core/trigger.core.js';
import hooksCore from '../core/hooks.core.js';
import { getSignedCookie, deleteCookie } from 'hono/cookie';
import wewebService from '../services/weweb.service.js';
import { getConnections, resolveConnection } from '../services/connection.service.js';

export const sessionMiddleware = async (c, next) => {
    // The app access gate of an internal app already loaded the WeWeb Auth session.
    if (c.get('user')) return next();

    const authIntegration = process.env.AUTH_INTEGRATION;
    const authConnectionId = process.env.AUTH_CONNECTION_ID;

    if (authIntegration) {
        const connection = authConnectionId ? resolveConnection(getConnections()[authConnectionId]) : null;
        const session = await getSignedCookie(c, process.env.AUTH_SECRET, 'ww-app-session', 'secure');

        if (session) {
            c.set('session', JSON.parse(session));
        }
        try {
            await hooksCore.execute(c, `auth-refresh/integration:${authIntegration}`, {
                session: c.get('session'),
                connection,
            });
        } catch (error) {
            c.set('user', null);
            c.set('session', null);
            await deleteCookie(c, 'ww-app-session', { 
                prefix: 'secure', 
                path: '/',
                secure: true,
                httpOnly: true,
                sameSite: 'None'
            });
        }
    }

    return next();
};

// Debug-run counterpart of sessionMiddleware: carry an auth context supplied by the caller instead
// of the app session cookie. Two exclusive inputs, mirroring the two auth worlds:
// - session: the integration session object, in the exact shape the integration's frontend stores
//   in the cookie (Xano: { accessToken }). Set it, then replay the provider's auth-refresh hook so
//   `user` is populated by the project's own workflow — identical to production, where the cookie
//   payload is JSON.parsed and never introspected either.
// - userId: WeWeb Auth impersonation through the provider's auth-mock hook (weweb-auth only today).
// The auth-refresh workflow it fires is the saved version, as in production: the hook reads the
// socket headers, absent on a server-to-server call. sessionMiddleware already ran auth-refresh
// once with an undefined session (it does on every debug request); this adds the productive run.
export const applyDebugAuth = async (c, auth) => {
    const authIntegration = process.env.AUTH_INTEGRATION;
    if (!authIntegration) throw new Error('This project has no auth provider: remove the "auth" input to run anonymously.');

    if (auth.session && typeof auth.session === 'object') {
        const authConnectionId = process.env.AUTH_CONNECTION_ID;
        const connection = authConnectionId ? resolveConnection(getConnections()[authConnectionId]) : null;
        c.set('session', auth.session);
        await hooksCore.execute(c, `auth-refresh/integration:${authIntegration}`, {
            session: c.get('session'),
            connection,
        });
    } else if (auth.userId) {
        await hooksCore.execute(c, `auth-mock/integration:${authIntegration}`, { userId: auth.userId });
    }

    // A provider without the matching hook leaves both empty: fail loudly instead of the silent
    // anonymous run that made auth.userId a no-op on integration-auth projects.
    if (!c.get('session') && !c.get('user')) {
        throw new Error(
            `The "${authIntegration}" auth provider did not accept this auth input on a debug run. Use "session" for an integration provider (the session object your integration stores, e.g. { accessToken } for Xano) or "userId" with WeWeb Auth.`
        );
    }
};
