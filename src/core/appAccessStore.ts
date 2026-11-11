import type { Pool, PoolClient } from 'pg';

// An internal app's own record of who may use it, in WeWeb Auth's schema of its own database: tables
// and columns WeWeb creates with the project's backend, and brings up to date, in each of its
// databases alike (`schema-migrations/access.sql` in weweb-back). This code only reads and writes
// them. Each person of the company directory WeWeb pushes, those who can use the app only, is a user
// (`auth.users`, their `directoryStatus` set), linked to their company account (`auth.accounts`, their
// directory subject as `accountId`), so the app's data can point to them before they first sign in.
// Their groups are `auth.directoryGroups` and `auth.directoryGroupMembers`. Who is granted the app is
// on the person or the group: by the project's managers (`accessGranted`), or, for the members WeWeb
// says can open every project of the workspace, by WeWeb (`accessManaged`). Someone may use the app
// when they are active in the directory and granted it, directly, through a group, or by WeWeb. Their
// roles are the names of their groups granted the app, and only those: in some companies anyone can
// create a group, under any name.

export type DirectoryKind = 'user' | 'group' | 'member';

export type DirectoryChange = {
    kind: DirectoryKind;
    key: string;
    data: Record<string, unknown>;
    deleted: boolean;
    seq: number;
};

export type DirectoryProvider = 'google' | 'microsoft';

export type DirectoryChanges = {
    connectionId: string;
    /** The provider of the directory: the one people's accounts are linked to. */
    provider: DirectoryProvider;
    fromSeq: number;
    toSeq: number;
    /**
     * From position 0: its copy again, on top of what the app holds of this company's directory, those no longer
     * in it sent as gone. Otherwise, a chunk from 0 starts the directory over.
     */
    replay?: boolean;
    entries: DirectoryChange[];
};

export type SyncState = { connectionId: string | null; seq: number; updatedAt: string | null };

/** `image`: their photo, when the provider gives one. */
export type DirectoryUser = {
    subject: string;
    email: string;
    name: string | null;
    image: string | null;
    status: string;
};
/** `deleted`: gone from the directory, kept for its grant. */
export type DirectoryGroup = {
    externalId: string;
    name: string;
    email: string | null;
    memberCount: number;
    deleted: boolean;
};

export type AppAccessGrants = {
    users: DirectoryUser[];
    groups: DirectoryGroup[];
    /** Those WeWeb grants it: they can open every project of the workspace. */
    managed: DirectoryUser[];
};

/**
 * How this code applies the directory. Raised whenever it applies more of it (a new field), or
 * otherwise (2: the roles from the groups granted the app only): a database on an older layout
 * reports position 0, for WeWeb to replay its copy from the start, deletions included. Nothing is
 * cleared first, so no one loses access in the meantime.
 */
const DIRECTORY_LAYOUT = 2;

// As WeWeb Auth's users table checks them.
const EMAIL_FORMAT = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

// Missing tables or columns: the database wasn't prepared by WeWeb (yet). Reads see an empty directory.
function isMissingAccessTableError(error: unknown) {
    const code = (error as { code?: string })?.code;
    return code === '42P01' || code === '3F000' || code === '42703';
}

// The people of the directory, by their subject: the users linked to an account of its provider.
const DIRECTORY_USERS = `(
    SELECT a."accountId" AS subject, u.id, u.email, u.name, u.image, u."directoryStatus" AS status, u."accessGranted", u."accessManaged"
    FROM auth.accounts a JOIN auth.users u ON u.id = a."userId"
    WHERE u."directoryStatus" IS NOT NULL AND a."providerId" = (SELECT provider FROM auth."directorySync" WHERE id = 1)
)`;

const MEMBER_COUNT = `(SELECT count(*) FROM auth."directoryGroupMembers" m WHERE m."externalId" = d."externalId") AS "memberCount"`;

async function readOrEmpty<T>(read: () => Promise<T>, empty: T): Promise<T> {
    try {
        return await read();
    } catch (error) {
        if (isMissingAccessTableError(error)) return empty;
        throw error;
    }
}

async function inTransaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        // Concurrent writers would race on the sync position and the grants.
        await client.query("SELECT pg_advisory_xact_lock(hashtext('auth.access'))");
        const result = await work(client);
        await client.query('COMMIT');
        return result;
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        client.release();
    }
}

// ======= DIRECTORY SYNC =======
export function parseDirectoryChanges(body: unknown): DirectoryChanges | null {
    const changes = body as Partial<DirectoryChanges>;
    if (!changes || typeof changes.connectionId !== 'string' || !changes.connectionId) return null;
    if (changes.provider !== 'google' && changes.provider !== 'microsoft') return null;
    if (!Number.isSafeInteger(changes.fromSeq) || changes.fromSeq! < 0) return null;
    if (!Number.isSafeInteger(changes.toSeq) || changes.toSeq! < changes.fromSeq!) return null;
    if (changes.replay !== undefined && typeof changes.replay !== 'boolean') return null;
    if (!Array.isArray(changes.entries)) return null;

    let previous = changes.fromSeq!;
    for (const entry of changes.entries) {
        if (!entry || !['user', 'group', 'member'].includes(entry.kind) || typeof entry.key !== 'string') return null;
        if (!entry.data || typeof entry.data !== 'object' || typeof entry.deleted !== 'boolean') return null;
        if (!Number.isSafeInteger(entry.seq) || entry.seq <= previous || entry.seq > changes.toSeq!) return null;
        previous = entry.seq;
    }
    return changes as DirectoryChanges;
}

function text(value: unknown) {
    return typeof value === 'string' ? value : null;
}

/**
 * A person of the directory, as a WeWeb Auth user linked to their company account: their name, email,
 * status and photo (`image`, when the provider gives one) follow the directory, and they are never
 * deleted, the app's data may point to them. A user of the same verified email, created another way,
 * becomes theirs, signed out of everything else; one whose email was never verified gives the address
 * up. One already linked to someone else of the directory keeps it, until the directory says
 * otherwise. `true` when they were just added.
 */
async function applyUser(
    client: PoolClient,
    provider: DirectoryProvider,
    subject: string,
    data: Record<string, unknown>,
    deleted: boolean
): Promise<boolean> {
    const status = deleted ? 'deleted' : text(data.status) || 'deleted';
    const email = (text(data.email) || '').toLowerCase();
    const name = text(data.name) || email;
    // Left out when the provider gives no photos: theirs stays.
    const hasPicture = Object.hasOwn(data, 'picture');
    const picture = text(data.picture);
    const { rows: accounts } = await client.query(
        'SELECT "userId" FROM auth.accounts WHERE "providerId" = $1 AND "accountId" = $2 LIMIT 1',
        [provider, subject]
    );
    if (accounts.length) {
        await client.query(
            `UPDATE auth.users SET "directoryStatus" = $2, name = COALESCE(NULLIF($3, ''), name), "updatedAt" = now(),
                email = CASE WHEN $4 <> '' AND NOT EXISTS (SELECT 1 FROM auth.users o WHERE o.email = $4 AND o.id <> $1) THEN $4 ELSE email END,
                image = CASE WHEN $5 THEN $6 ELSE image END
             WHERE id = $1`,
            [accounts[0].userId, status, name, EMAIL_FORMAT.test(email) ? email : '', hasPicture, picture]
        );
        return false;
    }
    if (deleted || status === 'deleted' || !EMAIL_FORMAT.test(email)) return false;

    const { rows: existing } = await client.query(
        `SELECT u.id, u."emailVerified" AS verified, EXISTS (SELECT 1 FROM auth.accounts a WHERE a."userId" = u.id AND a."providerId" = $2) AS linked
         FROM auth.users u WHERE u.email = $1`,
        [email, provider]
    );
    let userId = existing[0]?.id;
    if (userId && !existing[0].linked && !existing[0].verified) {
        // Its email was never proved: anyone could have signed up with the address. It leaves it to the directory's person.
        await client.query(
            `UPDATE auth.users SET email = 'unverified-' || id || '@directory.invalid', "updatedAt" = now() WHERE id = $1`,
            [userId]
        );
        userId = undefined;
    } else if (userId && !existing[0].linked) {
        // Theirs from now on, signed in with their company account only: whoever signed in to it another way is signed out.
        await client.query('DELETE FROM auth.sessions WHERE "userId" = $1', [userId]);
        await client.query('DELETE FROM auth.accounts WHERE "userId" = $1 AND "providerId" <> $2', [userId, provider]);
    }
    if (existing[0]?.linked) {
        // Someone gone from the directory leaves their email to the next one given it, as companies do.
        const { rowCount } = await client.query(
            `UPDATE auth.users SET email = 'deleted-' || id || '@directory.invalid', "updatedAt" = now() WHERE id = $1 AND "directoryStatus" = 'deleted'`,
            [userId]
        );
        if (!rowCount) {
            console.warn('[app-access] A person of the directory has the email of another one: not added yet');
            return false;
        }
        userId = undefined;
    }
    if (userId) {
        await client.query(
            'UPDATE auth.users SET "directoryStatus" = $2, name = $3, image = CASE WHEN $4 THEN $5 ELSE image END, "updatedAt" = now() WHERE id = $1',
            [userId, status, name, hasPicture, picture]
        );
    } else {
        const { rows } = await client.query(
            'INSERT INTO auth.users (name, email, "emailVerified", "directoryStatus", image) VALUES ($1, $2, true, $3, $4) RETURNING id',
            [name, email, status, picture]
        );
        userId = rows[0].id;
    }
    await client.query('INSERT INTO auth.accounts ("accountId", "providerId", "userId") VALUES ($1, $2, $3)', [
        subject,
        provider,
        userId,
    ]);
    return true;
}

/** The roles of the people of the directory: the names of their groups granted the app. */
async function refreshDirectoryRoles(client: PoolClient) {
    await client.query(`
        UPDATE auth.users u SET roles = r.names, "updatedAt" = now()
        FROM (
            SELECT d.id, COALESCE(array_agg(g.name ORDER BY g.name) FILTER (WHERE g.name IS NOT NULL), '{}') AS names
            FROM ${DIRECTORY_USERS} d
            LEFT JOIN auth."directoryGroupMembers" m ON m.subject = d.subject
            LEFT JOIN auth."directoryGroups" g ON g."externalId" = m."externalId" AND g."accessGranted"
            GROUP BY d.id
        ) r
        WHERE u.id = r.id AND u.roles IS DISTINCT FROM r.names
    `);
}

/**
 * Where the app is in the directory, as WeWeb goes on from it: at 0 when its layout is older, for
 * WeWeb to replay the directory.
 */
function readState(row: Record<string, any> | undefined): SyncState & { layoutOutdated: boolean } {
    const connectionId = row?.connectionId ?? null;
    const layoutOutdated = !!connectionId && Number(row?.layout ?? 0) < DIRECTORY_LAYOUT;
    return {
        connectionId,
        seq: layoutOutdated ? 0 : Number(row?.seq ?? 0),
        updatedAt: row?.updatedAt ?? null,
        layoutOutdated,
    };
}

/**
 * Applies a chunk of changes, only on top of the position it was computed from: anything else is
 * answered with the position the app is at, for WeWeb to go on from there. A chunk from position 0
 * replays the directory on top of an older layout, or of what the app holds when WeWeb says so
 * (`replay`: who can use the app changed); otherwise it starts the directory over: everyone and every
 * group in it is marked deleted until listed again, keeping their grant.
 */
export async function applyDirectoryChanges(
    pool: Pool,
    changes: DirectoryChanges
): Promise<{ applied: true; seq: number } | { applied: false; state: SyncState }> {
    return inTransaction(pool, async client => {
        const { rows } = await client.query(
            'SELECT "connectionId", seq, "updatedAt", layout FROM auth."directorySync" WHERE id = 1'
        );
        const { layoutOutdated, ...state } = readState(rows[0]);
        // A replay is its copy from the start, deletions included: what the app holds stays meanwhile.
        const replays =
            changes.fromSeq === 0 &&
            !!state.connectionId &&
            (changes.replay === true || (layoutOutdated && state.connectionId === changes.connectionId));

        if (changes.fromSeq === 0 && !replays) {
            await client.query('DELETE FROM auth."directoryGroupMembers"');
            await client.query('UPDATE auth."directoryGroups" SET deleted = true WHERE NOT deleted');
            await client.query(
                `UPDATE auth.users SET "directoryStatus" = 'deleted', "updatedAt" = now() WHERE "directoryStatus" IS NOT NULL AND "directoryStatus" <> 'deleted'`
            );
        } else if (
            changes.fromSeq !== 0 &&
            (state.connectionId !== changes.connectionId || state.seq !== changes.fromSeq)
        ) {
            return { applied: false as const, state };
        }
        // First: the directory's people are read through the provider's accounts.
        await client.query(
            `INSERT INTO auth."directorySync" (id, "connectionId", provider, seq, "updatedAt") VALUES (1, $1, $2, $3, now())
             ON CONFLICT (id) DO UPDATE SET "connectionId" = EXCLUDED."connectionId", provider = EXCLUDED.provider`,
            [changes.connectionId, changes.provider, changes.fromSeq]
        );

        let rolesChanged = false;
        for (const entry of changes.entries) {
            const { data } = entry;
            if (entry.kind === 'user') {
                rolesChanged =
                    (await applyUser(client, changes.provider, entry.key, data, entry.deleted)) || rolesChanged;
            } else if (entry.kind === 'group') {
                rolesChanged = true;
                if (entry.deleted) {
                    await client.query('UPDATE auth."directoryGroups" SET deleted = true WHERE "externalId" = $1', [
                        entry.key,
                    ]);
                    await client.query('DELETE FROM auth."directoryGroupMembers" WHERE "externalId" = $1', [entry.key]);
                    continue;
                }
                await client.query(
                    `INSERT INTO auth."directoryGroups" ("externalId", name, email) VALUES ($1, $2, $3)
                     ON CONFLICT ("externalId") DO UPDATE SET name = EXCLUDED.name, email = EXCLUDED.email, deleted = false`,
                    [entry.key, text(data.name) || entry.key, text(data.email)]
                );
            } else {
                const externalId = text(data.externalId);
                const subject = text(data.subject);
                if (!externalId || !subject) continue;
                rolesChanged = true;
                if (entry.deleted) {
                    await client.query(
                        'DELETE FROM auth."directoryGroupMembers" WHERE "externalId" = $1 AND subject = $2',
                        [externalId, subject]
                    );
                } else {
                    await client.query(
                        'INSERT INTO auth."directoryGroupMembers" ("externalId", subject) VALUES ($1, $2) ON CONFLICT DO NOTHING',
                        [externalId, subject]
                    );
                }
            }
        }
        // Roles an older layout gave are made again at once, the rest of the replay to come.
        if (rolesChanged || layoutOutdated) await refreshDirectoryRoles(client);

        await client.query('UPDATE auth."directorySync" SET seq = $1, layout = $2, "updatedAt" = now() WHERE id = 1', [
            changes.toSeq,
            DIRECTORY_LAYOUT,
        ]);
        return { applied: true as const, seq: changes.toSeq };
    });
}

export async function getSyncState(
    pool: Pool
): Promise<SyncState & { users: number; groups: number; grants: number; managed: number }> {
    return readOrEmpty(
        async () => {
            const { rows } = await pool.query(`
                SELECT s."connectionId", s.seq, s."updatedAt", s.layout,
                    (SELECT count(*) FROM ${DIRECTORY_USERS} d WHERE d.status = 'active') AS users,
                    (SELECT count(*) FROM auth."directoryGroups" WHERE NOT deleted) AS groups,
                    (SELECT count(*) FROM ${DIRECTORY_USERS} d WHERE d."accessGranted")
                        + (SELECT count(*) FROM auth."directoryGroups" WHERE "accessGranted") AS grants,
                    (SELECT count(*) FROM ${DIRECTORY_USERS} d WHERE d."accessManaged") AS managed
                FROM (SELECT 1) one LEFT JOIN auth."directorySync" s ON s.id = 1
            `);
            const row = rows[0] || {};
            const { layoutOutdated: _, ...state } = readState(row);
            return {
                ...state,
                users: Number(row.users ?? 0),
                groups: Number(row.groups ?? 0),
                grants: Number(row.grants ?? 0),
                managed: Number(row.managed ?? 0),
            };
        },
        { connectionId: null, seq: 0, updatedAt: null, users: 0, groups: 0, grants: 0, managed: 0 }
    );
}

/** How many hours ago a self-hosted app last pulled its directory and grants whole: null before the first time. */
export async function getPullAgeHours(pool: Pool): Promise<number | null> {
    return readOrEmpty(async () => {
        // In the database's own clock, which wrote it.
        const { rows } = await pool.query(
            'SELECT extract(epoch FROM (now()::timestamp - "pulledAt")) / 3600 AS hours FROM auth."directorySync" WHERE id = 1 AND "pulledAt" IS NOT NULL'
        );
        return rows[0] ? Number(rows[0].hours) : null;
    }, null);
}

/** A pull went through to its end: the directory, its grants and those who can open every project. */
export async function markPulled(pool: Pool): Promise<void> {
    await pool.query('UPDATE auth."directorySync" SET "pulledAt" = now() WHERE id = 1');
}

// ======= ACCESS =======
/** Whether the subject is an active user of the directory, granted the app directly, through a group or by WeWeb. */
export async function isSubjectAllowed(pool: Pool, subject: string): Promise<boolean> {
    return readOrEmpty(async () => {
        const { rows } = await pool.query(
            `SELECT EXISTS (
                SELECT 1 FROM ${DIRECTORY_USERS} u
                WHERE u.subject = $1 AND u.status = 'active' AND (
                    u."accessGranted" OR u."accessManaged" OR EXISTS (
                        SELECT 1 FROM auth."directoryGroupMembers" m
                        JOIN auth."directoryGroups" g ON g."externalId" = m."externalId"
                        WHERE m.subject = u.subject AND g."accessGranted"
                    )
                )
            ) AS allowed`,
            [subject]
        );
        return rows[0]?.allowed === true;
    }, false);
}

/** The names of the groups granted the app the subject is in: their WeWeb Auth roles. */
export async function getSubjectGroupNames(pool: Pool, subject: string): Promise<string[]> {
    return readOrEmpty(async () => {
        const { rows } = await pool.query(
            `SELECT g.name FROM auth."directoryGroupMembers" m
             JOIN auth."directoryGroups" g ON g."externalId" = m."externalId"
             WHERE m.subject = $1 AND g."accessGranted" ORDER BY g.name`,
            [subject]
        );
        return rows.map(row => row.name as string);
    }, []);
}

export async function listGrants(pool: Pool): Promise<AppAccessGrants> {
    return readOrEmpty(
        async () => {
            const grantedUsers = (column: 'accessGranted' | 'accessManaged') => `
                SELECT subject, email, name, image, status FROM ${DIRECTORY_USERS} d
                WHERE d."${column}" ORDER BY lower(COALESCE(d.name, d.email))
            `;
            const [users, groups, managed] = await Promise.all([
                pool.query(grantedUsers('accessGranted')),
                pool.query(`
                    SELECT d."externalId", d.name, d.email, d.deleted, ${MEMBER_COUNT}
                    FROM auth."directoryGroups" d WHERE d."accessGranted" ORDER BY lower(d.name)
                `),
                pool.query(grantedUsers('accessManaged')),
            ]);
            return {
                users: users.rows.map(toUser),
                managed: managed.rows.map(toUser),
                groups: groups.rows.map(toGroup),
            };
        },
        { users: [], groups: [], managed: [] }
    );
}

function toUser(row: Record<string, any>): DirectoryUser {
    return { subject: row.subject, email: row.email, name: row.name, image: row.image ?? null, status: row.status };
}

function toGroup(row: Record<string, any>): DirectoryGroup {
    return {
        externalId: row.externalId,
        name: row.name,
        email: row.email,
        memberCount: Number(row.memberCount),
        deleted: row.deleted === true,
    };
}

export function parseGrants(body: unknown, { max = 5000 }: { max?: number } = {}): { subjects: string[]; groupIds: string[] } | null {
    const grants = body as { subjects?: unknown; groupIds?: unknown };
    const strings = (value: unknown) =>
        Array.isArray(value) && value.every(item => typeof item === 'string' && item.length > 0 && item.length <= 256)
            ? [...new Set(value as string[])]
            : null;
    const subjects = strings(grants?.subjects);
    const groupIds = strings(grants?.groupIds);
    if (!subjects || !groupIds || subjects.length + groupIds.length > max) return null;
    return { subjects, groupIds };
}

/** Grants the users of `userIds`, and only them. */
async function grantUsers(client: PoolClient, column: 'accessGranted' | 'accessManaged', userIds: string[]) {
    await client.query(
        `UPDATE auth.users SET "${column}" = (id = ANY($1::uuid[])) WHERE "${column}" <> (id = ANY($1::uuid[]))`,
        [userIds]
    );
}

export type GrantChanges = {
    add: { subjects: string[]; groupIds: string[] };
    remove: { subjects: string[]; groupIds: string[] };
};

/** `{ add, remove }`, each `{ subjects, groupIds }`: grants given and taken away, the others kept. */
export function parseGrantChanges(body: unknown): GrantChanges | null {
    const changes = body as { add?: unknown; remove?: unknown };
    const add = parseGrants(changes?.add);
    const remove = parseGrants(changes?.remove);
    if (!add || !remove) return null;
    return { add, remove };
}

/**
 * Gives and takes away grants of the project's managers, leaving the others as they are: one person's or group's access
 * changed from WeWeb without replacing what others changed meanwhile. Only users and groups of the directory can be
 * given access, those gone from it included: they keep their grant until removed. Removing one not granted changes
 * nothing.
 */
export async function changeGrants(pool: Pool, { add, remove }: GrantChanges): Promise<void> {
    return inTransaction(pool, async client => {
        // One after the other: a client runs one query at a time.
        const knownUsers = await client.query(
            `SELECT d.subject, d.id FROM ${DIRECTORY_USERS} d WHERE d.subject = ANY($1)`,
            [add.subjects]
        );
        const knownGroups = await client.query(
            'SELECT "externalId" FROM auth."directoryGroups" WHERE "externalId" = ANY($1)',
            [add.groupIds]
        );
        const users = new Set(knownUsers.rows.map(row => row.subject));
        const groups = new Set(knownGroups.rows.map(row => row.externalId));
        const unknownSubjects = add.subjects.filter(subject => !users.has(subject));
        const unknownGroupIds = add.groupIds.filter(id => !groups.has(id));
        if (unknownSubjects.length || unknownGroupIds.length) {
            throw Object.assign(new Error('Unknown users or groups'), {
                code: 'UNKNOWN_GRANTEES',
                unknownSubjects,
                unknownGroupIds,
            });
        }

        await client.query(
            `UPDATE auth.users SET "accessGranted" = true WHERE NOT "accessGranted" AND id IN (SELECT d.id FROM ${DIRECTORY_USERS} d WHERE d.subject = ANY($1))`,
            [add.subjects]
        );
        await client.query(
            `UPDATE auth.users SET "accessGranted" = false WHERE "accessGranted" AND id IN (SELECT d.id FROM ${DIRECTORY_USERS} d WHERE d.subject = ANY($1))`,
            [remove.subjects.filter(subject => !users.has(subject))]
        );
        await client.query(
            `UPDATE auth."directoryGroups" SET "accessGranted" = true WHERE NOT "accessGranted" AND "externalId" = ANY($1)`,
            [add.groupIds]
        );
        await client.query(
            `UPDATE auth."directoryGroups" SET "accessGranted" = false WHERE "accessGranted" AND "externalId" = ANY($1)`,
            [remove.groupIds.filter(id => !groups.has(id))]
        );
        // Their members' roles.
        if (add.groupIds.length || remove.groupIds.length) await refreshDirectoryRoles(client);
    });
}

export function parseManagedGrants(body: unknown): string[] | null {
    const subjects = (body as { subjects?: unknown })?.subjects;
    if (!Array.isArray(subjects) || subjects.length > 5000) return null;
    if (!subjects.every(subject => typeof subject === 'string' && subject.length > 0 && subject.length <= 256))
        return null;
    return [...new Set(subjects as string[])];
}

/**
 * Replaces who WeWeb grants the app, the members who can open every project, the directory deciding
 * whether they get in. Not to be changed by hand: WeWeb sends the whole list again. How many of them
 * aren't in the directory yet (`missing`): WeWeb sends them again later.
 */
export async function setManagedGrants(pool: Pool, subjects: string[]): Promise<{ missing: number }> {
    return inTransaction(pool, async client => {
        const { rows } = await client.query(`SELECT d.id FROM ${DIRECTORY_USERS} d WHERE d.subject = ANY($1)`, [
            subjects,
        ]);
        await grantUsers(
            client,
            'accessManaged',
            rows.map(row => row.id)
        );
        return { missing: subjects.length - rows.length };
    });
}
