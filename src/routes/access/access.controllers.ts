import type { Context as HonoContext } from 'hono';
import { getAppAccessAuth, getAppAccessConfig } from '../../core/appAccess.core.ts';
import type { Pool } from 'pg';
import {
    applyDirectoryChanges,
    changeGrants,
    getSyncState,
    listGrants,
    parseDirectoryChanges,
    parseGrantChanges,
    parseManagedGrants,
    setManagedGrants,
} from '../../core/appAccessStore.ts';
import { getAppUrls } from '../../core/config.core.js';
import { PublicHTTPException } from '../../core/http.errors.ts';

const DENIED_PATH = '/api/ww/access/denied';
// Resolves relative redirects: any other origin is absolute.
const RELATIVE_BASE = 'http://relative.invalid';

// Starts the social sign-in with the workspace's provider, then comes back to `redirect`.
export const signIn = async (c: HonoContext) => {
    const auth = getAppAccessAuth();
    const { provider } = getAppAccessConfig();
    if (!auth || !provider) return c.redirect(DENIED_PATH);

    // Through the auth handler rather than its API: OAuth redirect URIs follow the host the browser
    // used (custom domains), which only the handler resolves. No cookies are forwarded: this
    // server-made POST needs none, and better-auth checks the origin of cookie-carrying requests.
    const headers = new Headers(c.req.raw.headers);
    headers.delete('cookie');
    headers.delete('content-length');
    headers.set('content-type', 'application/json');
    const tenantHost = c.req.header('x-tenant-host');
    if (tenantHost) headers.set('x-forwarded-host', tenantHost);

    const response = await auth.handler(
        new Request(new URL('/api/auth/sign-in/social', c.req.url), {
            method: 'POST',
            headers,
            body: JSON.stringify({
                provider,
                callbackURL: getSafeRedirect(c.req.query('redirect')),
                errorCallbackURL: DENIED_PATH,
            }),
        })
    );
    // Not a refusal: too many sign-ins started from this address at once. The page tries again on its own.
    if (response.status === 429) {
        const retryAfter = Math.max(1, Number(response.headers.get('x-retry-after')) || 10);
        c.header('Cache-Control', 'no-store');
        c.header('Retry-After', String(retryAfter));
        return c.html(tooManySignInsPage(retryAfter), 429);
    }
    const { url } = await response.json().catch(() => ({}));
    if (!response.ok || !url) {
        console.error('[app-access] Unable to start the sign-in', response.status);
        return c.redirect(DENIED_PATH);
    }

    const providerUrl = new URL(url);
    // "Try another account" on the denied page.
    if (c.req.query('prompt') === 'select_account') providerUrl.searchParams.set('prompt', 'select_account');

    for (const cookie of response.headers.getSetCookie()) c.header('Set-Cookie', cookie, { append: true });
    return c.redirect(providerUrl.toString());
};

// Only back to the app itself: one of its URLs or a path.
function getSafeRedirect(redirect: string | undefined) {
    if (!redirect) return '/';

    try {
        const url = new URL(redirect, RELATIVE_BASE);
        // A path of the app's: `//host` would be another site.
        if (url.origin === RELATIVE_BASE) return /^\/[\\/]/.test(url.pathname) ? '/' : url.pathname + url.search + url.hash;
        if (getAppOrigins().includes(url.origin)) return url.toString();
    } catch {}
    return '/';
}

function getAppOrigins() {
    return getAppUrls().flatMap((appUrl: string) => {
        try {
            return [new URL(appUrl).origin];
        } catch {
            return [];
        }
    });
}

export const getDenied = (c: HonoContext) => {
    c.header('Cache-Control', 'no-store');
    return c.html(DENIED_PAGE, 403);
};

// Where signing out of an internal app ends: any page of the app would sign the person straight back in, without a
// word from the provider. They sign in again when they ask, picking the account.
export const getSignedOut = (c: HonoContext) => {
    c.header('Cache-Control', 'no-store');
    return c.html(SIGNED_OUT_PAGE);
};

const page = (title: string, body: string, head = '') => `<!doctype html>
<html lang="en">
    <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex" />
${head}        <title>${title}</title>
        <style>
            body {
                margin: 0;
                min-height: 100vh;
                display: flex;
                align-items: center;
                justify-content: center;
                font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
                color: #1e2324;
                background: #f7f8f8;
            }
            main {
                max-width: 420px;
                margin: 16px;
                padding: 32px;
                border-radius: 12px;
                background: #fff;
                box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
            }
            h1 {
                margin: 0 0 8px;
                font-size: 20px;
            }
            p {
                margin: 0 0 24px;
                color: #5b6466;
                line-height: 1.5;
            }
            .actions {
                display: flex;
                gap: 12px;
            }
            a,
            button {
                padding: 8px 16px;
                border-radius: 8px;
                font: inherit;
                font-size: 14px;
                cursor: pointer;
                text-decoration: none;
            }
            a {
                color: #fff;
                background: #1e2324;
            }
            button {
                color: #1e2324;
                background: none;
                border: 1px solid #d5d9d9;
            }
        </style>
    </head>
    <body>
${body}    </body>
</html>
`;

const DENIED_PAGE = page(
    'Access denied',
    `        <main>
            <h1>You don't have access to this app</h1>
            <p>Sign in with an account that has access, or ask the app's administrator to give you access.</p>
            <div class="actions">
                <a href="/api/ww/access/sign-in?redirect=%2F&amp;prompt=select_account">Try another account</a>
                <button type="button" id="sign-out">Sign out</button>
            </div>
        </main>
        <script>
            document.getElementById('sign-out').addEventListener('click', async () => {
                await fetch('/api/auth/sign-out', {
                    method: 'POST',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: '{}',
                }).catch(() => {});
                window.location.reload();
            });
        </script>
`
);

const tooManySignInsPage = (retryAfter: number) =>
    page(
        'Too many sign-ins',
        `        <main>
            <h1>Too many sign-ins at once</h1>
            <p>Too many people started signing in from your network just now. This page tries again in a few seconds.</p>
            <div class="actions">
                <a href="">Try again</a>
            </div>
        </main>
`,
        `        <meta http-equiv="refresh" content="${retryAfter}" />
`
    );

const SIGNED_OUT_PAGE = page(
    'Signed out',
    `        <main>
            <h1>You're signed out</h1>
            <p>Sign in again to use this app.</p>
            <div class="actions">
                <a href="/api/ww/access/sign-in?redirect=%2F&amp;prompt=select_account">Sign in</a>
            </div>
        </main>
`
);

// ======= DIRECTORY AND GRANTS =======
// WeWeb pushes the directory and manages the grants for the project's access managers, on each
// environment's database, through the editor's server (`access.editor.routes.js`).
type PoolOf = (c: HonoContext) => Pool | null;

function readBody(c: HonoContext) {
    try {
        return JSON.parse(c.get('requestBody') || 'null');
    } catch {
        return null;
    }
}

export function accessHandlers(poolOf: PoolOf) {
    const getPool = (c: HonoContext) => {
        const pool = poolOf(c);
        if (!pool)
            throw new PublicHTTPException(409, 'The app has no database there', { code: 'APP_ACCESS_NO_DATABASE' });
        return pool;
    };

    return {
        // A chunk of directory changes: applied only on top of the position it starts from, else
        // the answer is the app's position, for WeWeb to go on from there.
        syncDirectory: async (c: HonoContext) => {
            const changes = parseDirectoryChanges(readBody(c));
            if (!changes)
                throw new PublicHTTPException(400, 'Invalid directory changes', { code: 'APP_ACCESS_INVALID_CHANGES' });

            const result = await applyDirectoryChanges(getPool(c), changes);
            if (result.applied === false) return c.json({ code: 'APP_ACCESS_OUT_OF_SYNC', ...result.state }, 409);
            return c.json({ seq: result.seq });
        },

        getAccessStatus: async (c: HonoContext) => {
            const pool = getPool(c);
            const [state, grants] = await Promise.all([getSyncState(pool), listGrants(pool)]);
            return c.json({ state, grants });
        },

        // Some grants given and others taken away, the rest kept.
        patchGrants: async (c: HonoContext) => {
            const changes = parseGrantChanges(readBody(c));
            if (!changes) throw new PublicHTTPException(400, 'Invalid grants', { code: 'APP_ACCESS_INVALID_GRANTS' });

            const pool = getPool(c);
            try {
                await changeGrants(pool, changes);
            } catch (error) {
                if ((error as { code?: string }).code !== 'UNKNOWN_GRANTEES') throw error;
                const { unknownSubjects, unknownGroupIds } = error as {
                    unknownSubjects: string[];
                    unknownGroupIds: string[];
                };
                throw new PublicHTTPException(400, 'Some users or groups are not in the directory', {
                    code: 'APP_ACCESS_UNKNOWN_GRANTEES',
                    unknownSubjects,
                    unknownGroupIds,
                });
            }
            return c.json({ grants: await listGrants(pool) });
        },

        // Those who can open every project of the workspace: WeWeb's whole list, replacing the last.
        putManagedGrants: async (c: HonoContext) => {
            const subjects = parseManagedGrants(readBody(c));
            if (!subjects) throw new PublicHTTPException(400, 'Invalid grants', { code: 'APP_ACCESS_INVALID_GRANTS' });

            const { missing } = await setManagedGrants(getPool(c), subjects);
            return c.json({ managed: subjects.length - missing, missing });
        },

    };
}
