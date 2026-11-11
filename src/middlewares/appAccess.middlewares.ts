import type { MiddlewareHandler } from 'hono';
import { getAppAccessAuth, getGroupRoles, getUserSubject, isAllowed, isInternal } from '../core/appAccess.core.ts';
import { PublicHTTPException } from '../core/http.errors.ts';

// Paths relative to the API mount (/api or /api/stream), each with its methods: anything else needs a
// session, a request left unanswered by these routes falling through to the app's own. Of the WeWeb
// Auth routes, only the ones a social sign-in needs: the others (email, magic link, account
// management...) don't exist on an internal app. `/ww/access/*` is the sign-in, the denied and the signed-out pages.
const OPEN_API_ROUTES: { methods: string[]; path: RegExp }[] = [
    { methods: ['GET', 'HEAD'], path: /^\/ww\/(health|version)$/ },
    { methods: ['GET', 'HEAD'], path: /^\/ww\/access\/(sign-in|denied|signed-out)$/ },
    { methods: ['POST'], path: /^\/auth\/sign-in\/social$/ },
    // Microsoft may answer with a form post.
    { methods: ['GET', 'POST'], path: /^\/auth\/callback\/[^/]+$/ },
    { methods: ['GET'], path: /^\/auth\/get-session$/ },
    { methods: ['POST'], path: /^\/auth\/sign-out$/ },
    { methods: ['GET'], path: /^\/auth\/error$/ },
];

// Internal apps: every request needs a WeWeb Auth session of someone still granted the app. Nothing
// else is open, webhooks included: a caller that can't sign in can't reach a workflow.
export const appAccessMiddleware: MiddlewareHandler = async (c, next) => {
    if (!isInternal() || c.req.method === 'OPTIONS') return next();

    const apiPath = getApiPath(c.req.path);
    if (apiPath !== null) {
        const isOpen = OPEN_API_ROUTES.some(route => route.methods.includes(c.req.method) && route.path.test(apiPath));
        if (isOpen) return next();
        if (/^\/auth(\/|$)/.test(apiPath)) return c.notFound();
    }

    const auth = getAppAccessAuth();
    const session = auth ? await auth.api.getSession({ headers: c.req.raw.headers }) : null;
    if (!session) throw new PublicHTTPException(401, 'Sign in to use this app.', { code: 'APP_ACCESS_REQUIRED' });

    const { internalAdapter } = await auth.$context;
    const subject = await getUserSubject(internalAdapter, session.user.id);
    if (!(await isAllowed(subject))) {
        // No longer granted, or suspended, since signing in: the session goes too.
        await internalAdapter.deleteSession(session.session.token);
        throw new PublicHTTPException(403, "You don't have access to this app.", { code: 'APP_ACCESS_DENIED' });
    }

    // Same context as the WeWeb Auth auth-refresh hook: sessionMiddleware won't load it again. The
    // roles are the user's current directory groups, not the ones saved when they signed in.
    c.set('user', { ...session.user, roles: await getGroupRoles(subject) });
    c.set('session', session.session);
    return next();
};

function getApiPath(path: string) {
    for (const prefix of ['/api/stream', '/api']) {
        if (path === prefix || path.startsWith(`${prefix}/`)) return path.slice(prefix.length) || '/';
    }
    return null;
}
