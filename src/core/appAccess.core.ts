import { createHmac } from 'node:crypto';
import { decodeJwt } from 'jose';
import databaseService from '../services/database/database.service.ts';
import { getAppAccessSecret } from '../services/env.service.ts';
import { getPullAgeHours, getSubjectGroupNames, isSubjectAllowed } from './appAccessStore.ts';

// Internal apps: only the people granted the app may use it, signing in with their company Google
// or Microsoft account, through the workspace's own OAuth client. Who they are and who is granted
// is in the app's own database (`appAccessStore.ts`): the app never calls WeWeb to check it.

type AppAccessProvider = 'google' | 'microsoft';

type ProviderTokens = {
    idToken?: string;
};

type AuthAccount = {
    providerId: string;
    accountId: string;
};

type AuthInternalAdapter = {
    findAccounts: (userId: string) => Promise<AuthAccount[]>;
    deleteSession: (token: string) => Promise<void>;
};

export type AppAccessAuth = {
    api: {
        getSession: (context: { headers: Headers }) => Promise<{
            user: { id: string } & Record<string, unknown>;
            session: { token: string } & Record<string, unknown>;
        } | null>;
    };
    $context: Promise<{ internalAdapter: AuthInternalAdapter }>;
    handler: (request: Request) => Promise<Response>;
};

const ACCESS_CACHE_TTL_MS = 30_000;

// The gate is never active in the editor: only published environments are restricted.
export function isInternal() {
    return process.env.APP_ACCESS === 'internal' && process.env.ENV !== 'editor';
}

export function getAppAccessConfig() {
    const provider = process.env.APP_ACCESS_PROVIDER;
    return {
        provider: provider === 'google' || provider === 'microsoft' ? (provider as AppAccessProvider) : null,
        clientId: process.env.APP_ACCESS_CLIENT_ID,
        clientSecret: getAppAccessSecret('APP_ACCESS_CLIENT_SECRET'),
        domains: parseDomains(process.env.APP_ACCESS_DOMAINS),
        tenantId: process.env.APP_ACCESS_TENANT_ID?.toLowerCase() || null,
        // The callback all the workspace's apps share, and this app's tickets and secrets, by address: see `addCallbackTicket`.
        callbackUrl: process.env.APP_ACCESS_CALLBACK_URL || null,
        callbackTickets: parseTickets(process.env.APP_ACCESS_CALLBACK_TICKETS),
        callbackSecrets: parseTickets(getAppAccessSecret('APP_ACCESS_CALLBACK_SECRETS')),
    };
}

/**
 * The provider sends people back to the workspace's callback, which sends them on to the app named in the `state`: after
 * the state better-auth checks, which the relay gives back alone, the ticket of the address they signed in from, and the
 * state signed with that address's secret, which only this server holds. Null when that address has none.
 */
export function addCallbackTicket(authorizationUrl: string, origin: string): string | null {
    const { callbackTickets, callbackSecrets } = getAppAccessConfig();
    const ticket = callbackTickets[origin];
    const secret = callbackSecrets[origin];
    if (!ticket || !secret) return null;
    const url = new URL(authorizationUrl);
    const state = url.searchParams.get('state');
    if (!state) return null;
    const signature = createHmac('sha256', secret).update(state).digest('base64url');
    url.searchParams.set('state', `${state}.${ticket}.${signature}`);
    return url.toString();
}

function parseTickets(value: string | undefined): Record<string, string> {
    try {
        const tickets = JSON.parse(value || '{}');
        if (!tickets || typeof tickets !== 'object' || Array.isArray(tickets)) return {};
        return Object.fromEntries(Object.entries(tickets).filter(([, ticket]) => typeof ticket === 'string')) as Record<string, string>;
    } catch {
        return {};
    }
}

function parseDomains(value: string | undefined): string[] {
    try {
        const domains = JSON.parse(value || '[]');
        return Array.isArray(domains)
            ? domains.filter(domain => typeof domain === 'string').map(domain => domain.toLowerCase())
            : [];
    } catch {
        return [];
    }
}

// WeWeb Auth registers its instance when it loads: the gate never imports better-auth itself, so
// projects without WeWeb Auth don't bundle it. An internal app without it lets nobody in.
let appAccessAuth: AppAccessAuth | null = null;

export function registerAppAccessAuth(auth: AppAccessAuth | null) {
    appAccessAuth = auth;
}

export function getAppAccessAuth() {
    return appAccessAuth;
}

// ======= ACCESS =======
// Each subject's answer is kept a few seconds, per instance: a grant removed or an account suspended
// takes effect within that delay. Changes are applied by the editor's server, which checks no access.
const accessCache = new Map<string, { allowed: boolean; roles: string[]; expiresAt: number }>();

/** Forgets every answer kept. */
export function invalidateAppAccess() {
    accessCache.clear();
}

async function getAccess(subject: string) {
    const cached = accessCache.get(subject);
    if (cached && cached.expiresAt > Date.now()) return cached;
    const pool = databaseService.pool;
    if (!pool) return { allowed: false, roles: [] as string[] };

    const [allowed, roles] = await Promise.all([isSubjectAllowed(pool, subject), getSubjectGroupNames(pool, subject)]);
    const access = { allowed, roles, expiresAt: Date.now() + ACCESS_CACHE_TTL_MS };
    accessCache.set(subject, access);
    return access;
}

export async function isAllowed(subject: string | null | undefined) {
    if (!subject) return false;
    return (await getAccess(subject)).allowed;
}

/** The names of the groups granted the app the subject is in, which internal apps use as their roles. */
export async function getGroupRoles(subject: string | null | undefined) {
    if (!subject) return [];
    return (await getAccess(subject)).roles;
}

// The account ID of the user's provider account is their directory subject (Google `sub`, Microsoft `oid`).
export async function getUserSubject(internalAdapter: AuthInternalAdapter | undefined, userId: string) {
    const { provider } = getAppAccessConfig();
    if (!internalAdapter || !provider || !userId) return null;

    const accounts = await internalAdapter.findAccounts(userId);
    return accounts.find(account => account.providerId === provider)?.accountId || null;
}

// Self-hosted, its operator can refuse sign-ins on a list older than `APP_ACCESS_MAX_STALE_HOURS`: the pull stopped
// running, and access taken away on WeWeb since isn't here. Those signed in stay until their session ends.
async function isAccessListStale(maxHours: number) {
    const pool = databaseService.pool;
    if (!pool) return true;
    const age = await getPullAgeHours(pool);
    return age === null || age > maxHours;
}

// ======= SIGN-IN =======
// Replaces the provider's getUserInfo: better-auth redirects to the error URL before writing anything
// when it returns null. The ID token comes straight from the provider's token endpoint.
export async function getAppAccessUserInfo(token: ProviderTokens) {
    const { provider, domains, tenantId } = getAppAccessConfig();
    if (!token?.idToken) return null;
    const maxStaleHours = Number(process.env.APP_ACCESS_MAX_STALE_HOURS);
    if (maxStaleHours > 0 && (await isAccessListStale(maxStaleHours))) {
        return refuse(`who can use the app wasn't pulled from WeWeb for over ${maxStaleHours} hours`);
    }

    let profile: Record<string, any>;
    try {
        profile = decodeJwt(token.idToken);
    } catch {
        return null;
    }

    try {
        if (provider === 'google') {
            if (profile.email_verified !== true) return refuse('the email is not verified');
            if (typeof profile.hd !== 'string' || !domains.includes(profile.hd.toLowerCase())) {
                return refuse('the account is not from an allowed company domain');
            }
            if (!(await isAllowed(profile.sub))) return refuse('the account is not granted the app');

            return {
                user: {
                    id: profile.sub,
                    name: profile.name,
                    email: profile.email,
                    image: profile.picture,
                    emailVerified: profile.email_verified,
                },
                data: profile,
            };
        }

        if (provider === 'microsoft') {
            // An account without a mailbox has no `email` claim: the directory lists it by its sign-in name.
            const email = profile.email || profile.preferred_username;
            if (!email) return refuse('the account has no email');
            if (!tenantId || String(profile.tid).toLowerCase() !== tenantId) {
                return refuse('the account is not from the company tenant');
            }
            if (!(await isAllowed(profile.oid))) return refuse('the account is not granted the app');

            // Same email verification as better-auth's Microsoft provider: the optional claim, else the verified addresses.
            const emailVerified =
                profile.email_verified !== undefined
                    ? profile.email_verified
                    : !!(
                          profile.verified_primary_email?.includes(email) ||
                          profile.verified_secondary_email?.includes(email)
                      );

            // The directory object ID, not `sub` (unique per application): it is the subject in the directory.
            return {
                user: {
                    id: profile.oid,
                    name: profile.name,
                    email,
                    image: profile.picture,
                    emailVerified,
                },
                data: profile,
            };
        }
    } catch (error) {
        console.error('[app-access] Unable to check the access', error);
        return null;
    }

    return null;
}

function refuse(reason: string) {
    console.warn(`[app-access] Sign-in refused: ${reason}`);
    return null;
}
