import type { Pool } from 'pg';
import appAccessData from '../data/appAccess.json' with { type: 'json' };
import {
    applyDirectoryChanges,
    changeGrants,
    getSyncState,
    listGrants,
    markPulled,
    parseDirectoryChanges,
    parseGrants,
    parseManagedGrants,
    setManagedGrants,
} from './appAccessStore.ts';

// Self-hosted internal apps: WeWeb pushes the company directory and who is granted the app into the databases it hosts,
// but can't reach one hosted elsewhere, often behind a firewall. Its operator runs `node index.mjs access:pull` every
// few minutes instead (cron, a Kubernetes CronJob...): it pulls the same changes from WeWeb, from where the database is,
// with the workspace's private key, which only the pull is given. The app still checks who signs in on its own, with no
// call to WeWeb: out of reach, it keeps the last list. The access tables' SQL comes with the export: nothing WeWeb
// answers is ever run.

type Grants = { subjects: string[]; groupIds: string[] };

// A run pulls 200 chunks of a thousand changes at most: the next one goes on.
const MAX_REQUESTS = 200;
// The public API takes 3 requests a second for a key.
const RETRIES = 5;
const RATE_LIMITED_MS = 1100;

export class AppAccessPullError extends Error {}

/** Pulls into `pool` what changed in WeWeb since the last time, the grants and those who can open every project. */
export async function pullAppAccess({
    pool,
    url,
    privateKey,
    request = fetch,
    wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms)),
    schemaSql = appAccessData.schemaSql,
}: {
    pool: Pool;
    url: string | undefined;
    privateKey: string | undefined;
    request?: typeof fetch;
    wait?: (ms: number) => Promise<unknown>;
    schemaSql?: string | null;
}): Promise<{ seq: number; changes: number; grants: number; managed: number }> {
    if (!url) throw new AppAccessPullError('APP_ACCESS_PULL_URL is not set: use the environment variables of the export.');
    if (!privateKey) throw new AppAccessPullError("WEWEB_PRIVATE_KEY is not set: it is the workspace's private key, in its settings on WeWeb.");
    if (!isSecureAddress(url)) throw new AppAccessPullError('APP_ACCESS_PULL_URL must be an https address.');

    let schemaApplied = false;
    let outOfSync = 0;
    let changes = 0;
    for (let count = 0; count < MAX_REQUESTS; count++) {
        const state = await getSyncState(pool);
        const answer = await pull(url, privateKey, { connectionId: state.connectionId, fromSeq: state.seq }, { request, wait });
        if (!schemaApplied) {
            await applySchema(pool, schemaSql);
            schemaApplied = true;
        }

        const chunk = parseDirectoryChanges(answer);
        if (!chunk) throw new AppAccessPullError('WeWeb sent directory changes this server cannot read: export it again.');
        const result = await applyDirectoryChanges(pool, chunk);
        // Another run moved the database meanwhile: it goes on from there.
        if (!result.applied) {
            if (++outOfSync > 2) throw new AppAccessPullError('Another pull keeps moving this database: run one at a time.');
            continue;
        }
        changes += chunk.entries.length;
        if (answer.more) continue;

        // Every grant of the app, however many.
        const grants = parseGrants(answer.grants, { max: Number.MAX_SAFE_INTEGER });
        const managed = parseManagedGrants(answer.managed);
        if (!grants || !managed) throw new AppAccessPullError('WeWeb sent grants this server cannot read: export it again.');
        await replaceGrants(pool, grants);
        await setManagedGrants(pool, managed);
        // What `APP_ACCESS_MAX_STALE_HOURS` measures: a pull that fails on the way never counts.
        await markPulled(pool);
        return { seq: result.seq, changes, grants: grants.subjects.length + grants.groupIds.length, managed: managed.length };
    }
    return { seq: (await getSyncState(pool)).seq, changes, grants: 0, managed: 0 };
}

async function pull(
    url: string,
    privateKey: string,
    { connectionId, fromSeq }: { connectionId: string | null; fromSeq: number },
    { request, wait }: { request: typeof fetch; wait: (ms: number) => Promise<unknown> }
) {
    const address = new URL(url);
    if (connectionId) address.searchParams.set('connectionId', connectionId);
    address.searchParams.set('fromSeq', String(fromSeq));
    for (let attempt = 0; ; attempt++) {
        const response = await request(address, {
            headers: { authorization: `Bearer ${privateKey}`, accept: 'application/json' },
            // The key only ever goes to that address.
            redirect: 'error',
            signal: AbortSignal.timeout(30_000),
        });
        if (response.status === 429 && attempt < RETRIES) {
            await wait(RATE_LIMITED_MS * (attempt + 1));
            continue;
        }
        if (response.ok) return (await response.json()) as Record<string, any>;
        const body = (await response.json().catch(() => null)) as { code?: string } | null;
        throw new AppAccessPullError(pullFailure(response.status, body?.code));
    }
}

function pullFailure(status: number, code: string | undefined) {
    if (status === 401) return "WeWeb refused WEWEB_PRIVATE_KEY: copy the workspace's current private key from its settings.";
    if (status === 402) return "The workspace's plan doesn't include WeWeb's public API, which the pull goes through.";
    if (status === 404) return 'WeWeb has no such project in this workspace: check APP_ACCESS_PULL_URL.';
    if (code === 'APP_ACCESS_NOT_INTERNAL') return "The project isn't internal on WeWeb, or its workspace's directory isn't connected.";
    if (code === 'APP_ACCESS_SERVER_NOT_READY') return "The project's database on WeWeb, which keeps who can use the app, isn't set up yet.";
    return `WeWeb answered ${status}${code ? ` (${code})` : ''}: try again in a few minutes.`;
}

// Plain HTTP only to this machine, for local development.
function isSecureAddress(url: string) {
    try {
        const { protocol, hostname } = new URL(url);
        return protocol === 'https:' || (protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(hostname));
    } catch {
        return false;
    }
}

/** The access tables, as the export brings them: their SQL only changes what is missing. */
async function applySchema(pool: Pool, sql: unknown) {
    if (typeof sql !== 'string' || !sql.trim()) throw new AppAccessPullError('This export has no access tables: export it again.');
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query("SELECT pg_advisory_xact_lock(hashtext('auth.access.schema'))");
        await client.query(sql);
        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        client.release();
    }
}

/** WeWeb's grants instead of the database's: what was given and taken away there, the people gone from the directory left out. */
async function replaceGrants(pool: Pool, wanted: Grants) {
    const current = await listGrants(pool);
    const held = { subjects: current.users.map(user => user.subject), groupIds: current.groups.map(group => group.externalId) };
    const missing = (from: string[], other: string[]) => from.filter(value => !other.includes(value));
    let add = { subjects: missing(wanted.subjects, held.subjects), groupIds: missing(wanted.groupIds, held.groupIds) };
    const remove = { subjects: missing(held.subjects, wanted.subjects), groupIds: missing(held.groupIds, wanted.groupIds) };
    if (![...add.subjects, ...add.groupIds, ...remove.subjects, ...remove.groupIds].length) return;
    try {
        await changeGrants(pool, { add, remove });
    } catch (error) {
        const { code, unknownSubjects = [], unknownGroupIds = [] } = error as {
            code?: string;
            unknownSubjects?: string[];
            unknownGroupIds?: string[];
        };
        if (code !== 'UNKNOWN_GRANTEES') throw error;
        add = { subjects: missing(add.subjects, unknownSubjects), groupIds: missing(add.groupIds, unknownGroupIds) };
        await changeGrants(pool, { add, remove });
    }
}

/** `node index.mjs access:pull`: pulls once, and exits 0, or 1 with what to fix. */
export async function runAppAccessPull(): Promise<number> {
    if (process.env.APP_ACCESS !== 'internal') {
        console.error('[app-access] This app is not internal: there is nothing to pull.');
        return 1;
    }
    const { default: databaseService } = await import('../services/database/database.service.ts');
    if (!databaseService.pool) {
        console.error('[app-access] DATABASE_URL is not set: the pull writes who can use the app into its database.');
        return 1;
    }
    try {
        const result = await pullAppAccess({
            pool: databaseService.pool,
            url: process.env.APP_ACCESS_PULL_URL,
            privateKey: process.env.WEWEB_PRIVATE_KEY,
        });
        console.log(
            `[app-access] Pulled ${result.changes} directory changes, now at ${result.seq}: ${result.grants} grants, ${result.managed} people who can open every project.`
        );
        return 0;
    } catch (error) {
        console.error(`[app-access] The pull failed: ${error instanceof AppAccessPullError ? error.message : (error as Error)?.message || error}`);
        return 1;
    } finally {
        await databaseService.pool.end().catch(() => {});
    }
}
