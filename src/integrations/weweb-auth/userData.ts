import authUsersColumns from '../../data/authUsersColumns.json' with { type: 'json' };

type AuthUserColumn = {
    name?: string;
    isSystem?: boolean;
};

const BASE_USER_WRITABLE_KEYS = new Set(['email', 'name', 'image', 'roles', 'emailVerified']);
/** WeWeb's, for an internal app: the people of its company directory and who is granted it. */
export const WEWEB_USER_KEYS = ['directoryStatus', 'accessGranted', 'accessManaged'];
const PROTECTED_USER_KEYS = new Set([
    'id',
    'createdAt',
    'updatedAt',
    'password',
    'providers',
    'userId',
    'fields',
    ...WEWEB_USER_KEYS,
]);
/** What the company directory says of its people, synced by WeWeb: not to be changed from the editor. */
const DIRECTORY_USER_KEYS = ['email', 'name', 'image', 'roles'];
const AUTH_USER_COLUMNS = authUsersColumns.columns as AuthUserColumn[];

export function getWritableUserColumns(columns: AuthUserColumn[] = AUTH_USER_COLUMNS): Set<string> {
    const writableColumns = new Set(BASE_USER_WRITABLE_KEYS);

    for (const column of columns) {
        if (!column.name) continue;
        if (column.isSystem) continue;
        if (PROTECTED_USER_KEYS.has(column.name)) continue;
        writableColumns.add(column.name);
    }

    return writableColumns;
}

/**
 * Whether the user is a person of an internal app's company directory (`userId`), or any user is one: those the
 * directory says something of. Read as JSON: only an internal app's users have the column.
 */
export async function isDirectoryUser(
    pool: { query: (sql: string, params: unknown[]) => Promise<{ rows: { found: boolean }[] }> },
    userId?: string
) {
    const { rows } = await pool.query(
        `SELECT EXISTS (SELECT 1 FROM auth.users u WHERE to_jsonb(u) ->> 'directoryStatus' IS NOT NULL AND ($1::uuid IS NULL OR u.id = $1::uuid)) AS found`,
        [userId ?? null]
    );
    return rows[0]?.found === true;
}

/** The user's fields that may be changed, without the directory's own when they are one of its people. */
export function withoutDirectoryFields(data: Record<string, unknown>, isDirectoryUser: boolean) {
    if (!isDirectoryUser) return data;
    return Object.fromEntries(Object.entries(data).filter(([key]) => !DIRECTORY_USER_KEYS.includes(key)));
}

export function pickWritableUserData(
    input: Record<string, unknown> | null | undefined,
    columns: AuthUserColumn[] = AUTH_USER_COLUMNS
) {
    const writableColumns = getWritableUserColumns(columns);
    const data: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(input || {})) {
        if (!writableColumns.has(key)) continue;
        if (value === undefined) continue;
        data[key] = value;
    }

    return data;
}
