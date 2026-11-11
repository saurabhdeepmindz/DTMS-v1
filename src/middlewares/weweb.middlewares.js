import { getSignedCookie, setSignedCookie, getCookie } from 'hono/cookie';
import { HTTPException } from 'hono/http-exception';
import wewebService from '../services/weweb.service.js';

// The editor shown in ChatGPT is a cross-site frame: it never sends the session cookie, only its embed token in this
// header (weweb-editor _manager/services/chatgptEmbed). The token lives an hour: it never earns the 7-day trust
// cookie, only a short trust in memory, so its requests don't each ask weweb-back.
const EMBED_TOKEN_HEADER = 'ww-access-token';
const EMBED_TRUST_MS = 60 * 1000;
const EMBED_TRUST_MAX_ENTRIES = 1000;
const trustedEmbedTokens = new Map();

const isTrustedEmbedToken = token => {
    const expiresAt = trustedEmbedTokens.get(token);
    if (expiresAt && expiresAt > Date.now()) return true;
    trustedEmbedTokens.delete(token);
    return false;
};

const trustEmbedToken = token => {
    const now = Date.now();
    for (const [key, expiresAt] of trustedEmbedTokens) if (expiresAt <= now) trustedEmbedTokens.delete(key);
    if (trustedEmbedTokens.size >= EMBED_TRUST_MAX_ENTRIES) trustedEmbedTokens.delete(trustedEmbedTokens.keys().next().value);
    trustedEmbedTokens.set(token, now + EMBED_TRUST_MS);
};

export const ensureWWAuth = async (c, next) => {
    if (c.get('wwAuthorized')) return next();
    if (process.env.WEWEB_ENV === 'local' && process.env.NODE_ENV === 'production') return next();
    const secret = process.env.WEWEB_PROJECT_SECRET;
    if (!secret) {
        throw new HTTPException(503, { message: 'Editor server authentication is not configured. Redeploy the server.' });
    }

    // Used for weweb-ai or weweb-back
    if (c.req.header('ww-project-secret') === secret) {
        c.set('wwAuthorized', true);
        return next();
    }

    const lambdaCookieName = `ww-${process.env.WEWEB_PROJECT_ID}-access-token`;
    const userCookieName = 'ww-access-token';

    const lambdaCookie = await getSignedCookie(c, secret, lambdaCookieName);

    if (lambdaCookie && lambdaCookie !== false) {
        c.set('wwAuthorized', true);
        return next();
    }

    // The embed token first: outside production the session cookie is SameSite=None and may come along with it, but
    // it can be another account's (a developer signed in to WeWeb in the same browser)
    const embedToken = c.req.header(EMBED_TOKEN_HEADER);
    const userCookie = embedToken ? null : getCookie(c, userCookieName);

    if (!userCookie && !embedToken) {
        throw new HTTPException(401, { message: 'Unauthorized', cause: 'No user cookie found' });
    }

    if (embedToken && isTrustedEmbedToken(embedToken)) {
        return next();
    }

    try {
        // weweb-back reads an embed token from the cookie as it does a session token
        await wewebService.ensureDesignAccess(process.env.WEWEB_PROJECT_ID, userCookie || embedToken);
    } catch (error) {
        console.log(error);
        console.log(process.env.WEWEB_PROJECT_ID);
        throw new HTTPException(403, { message: 'Forbidden', cause: 'No design access' });
    }

    if (embedToken) {
        trustEmbedToken(embedToken);
        return next();
    }

    await setSignedCookie(c, lambdaCookieName, 'trust', secret, {
        path: '/',
        secure: true,
        httpOnly: true,
        sameSite: 'None',
        maxAge: 60 * 60 * 24 * 7, // 7 days
    });

    c.set('wwAuthorized', true);
    return next();
};
