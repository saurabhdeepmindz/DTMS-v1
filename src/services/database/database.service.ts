import { Pool } from 'pg';
import { getCountQuery, getDeleteQuery, getInsertQuery, getSelectQuery, getUpdateQuery } from './queryBuilder.ts';
import { getGroupedQuery, getSummaryQuery } from './grouping.ts';
import { getEnv } from '../env.service.ts';
import { getEditorRuntime } from '../editorRuntime.service.ts';
import type { FormulaNotice } from './formulaWarnings.ts';
import { getQueryTimeoutMs } from './queryTimeout.ts';

type DatabaseEnv = 'current' | 'editor' | 'staging' | 'production' | string | null | undefined;
type ResolvedDatabaseEnv = 'current' | 'staging' | 'production';

type ExecuteOptions = {
    query: string;
    params?: unknown[];
    currentUser?: { id: string } | null;
    env?: DatabaseEnv;
    onNotice?: (notice: FormulaNotice) => void;
};

const pools: Record<ResolvedDatabaseEnv, Pool | null> = {
    current: null,
    staging: null,
    production: null,
};

const poolsInitialized: Record<ResolvedDatabaseEnv, boolean> = {
    current: false,
    staging: false,
    production: false,
};

const editorPools = new Map<string, { pool: Pool; lastUsedAt: number }>();
const editorConnectionStrings = new Map<ResolvedDatabaseEnv, string | undefined>();
// Keep idle retired pools through the maximum Lambda request lifetime. An old
// snapshot can keep querying alongside a request that loaded new credentials.
const EDITOR_POOL_RETIREMENT_GRACE_MS = 15 * 60 * 1000;

function getEditorPool(env: ResolvedDatabaseEnv): Pool | null {
    const connectionString = resolveDatabaseConnectionString(env);
    const now = Date.now();
    editorConnectionStrings.set(env, connectionString);
    const currentStrings = new Set(editorConnectionStrings.values());
    for (const [key, entry] of editorPools) {
        if (currentStrings.has(key) || now - entry.lastUsedAt < EDITOR_POOL_RETIREMENT_GRACE_MS) continue;
        // pg.end() does not drain queued connect() waiters, so never retire a
        // pool until all clients are idle and no acquisition is queued.
        if (entry.pool.waitingCount || entry.pool.totalCount !== entry.pool.idleCount) continue;
        editorPools.delete(key);
        entry.pool.end().catch(() => console.warn('Failed to close retired editor database pool'));
    }
    if (!connectionString) return null;
    const existing = editorPools.get(connectionString);
    if (existing) {
        existing.lastUsedAt = now;
        return existing.pool;
    }
    const pool = new Pool({ connectionString });
    editorPools.set(connectionString, { pool, lastUsedAt: now });
    return pool;
}

function normalizeDatabaseEnv(env?: DatabaseEnv): ResolvedDatabaseEnv {
    if (env === 'staging') return 'staging';
    if (env === 'production') return 'production';
    return 'current';
}

function resolveDatabaseConnectionString(env: ResolvedDatabaseEnv): string | undefined {
    if (env === 'staging') {
        return getEnv('DATABASE_URL', 'staging');
    }
    if (env === 'production') {
        return getEnv('DATABASE_URL', 'production');
    }
    return getEnv('DATABASE_URL', 'current');
}

function getPoolInstance(env: ResolvedDatabaseEnv): Pool | null {
    if (getEditorRuntime()) return getEditorPool(env);
    if (!poolsInitialized[env]) {
        const connectionString = resolveDatabaseConnectionString(env);
        pools[env] = connectionString ? new Pool({ connectionString }) : null;
        poolsInitialized[env] = true;
    }
    return pools[env];
}

const databaseService = {
    get pool() {
        return getPoolInstance('current');
    },
    get stagingPool() {
        return getPoolInstance('staging');
    },
    get productionPool() {
        return getPoolInstance('production');
    },
    getPool: (env?: DatabaseEnv) => {
        return getPoolInstance(normalizeDatabaseEnv(env));
    },
    getSelectQuery,
    getCountQuery,
    getGroupedQuery,
    getSummaryQuery,
    getInsertQuery,
    getUpdateQuery,
    getDeleteQuery,

    async execute({ query, params = [], currentUser = null, env = null, onNotice }: ExecuteOptions) {
        const poolInstance = databaseService.getPool(env);
        if (!poolInstance) {
            throw new Error(`No database pool available for environment: ${env}`);
        }
        const client = await poolInstance.connect();
        let previousTimeout: string | undefined;
        let discardClient = false;
        try {
            const timeout = getQueryTimeoutMs();
            // If setup fails before returning the snapshot, its session state is
            // unknown. Discard that connection rather than return it to the pool.
            discardClient = true;
            const previous = await client.query(`WITH previous AS MATERIALIZED (
                SELECT current_setting('statement_timeout') AS value, setting::integer AS milliseconds
                FROM pg_settings WHERE name = 'statement_timeout'
            )
            SELECT value,
                set_config('statement_timeout', LEAST($1::integer, COALESCE(NULLIF(milliseconds, 0), $1::integer))::text || 'ms', false),
                CASE WHEN $2::text IS NOT NULL THEN set_config('app.user_id', $2, false) END
            FROM previous`, [timeout, currentUser?.id ?? null]);
            previousTimeout = previous.rows[0].value;
            discardClient = false;
            if (onNotice) client.on('notice', onNotice);
            const result = await client.query(query, params);
            return result?.rows || [];
        } finally {
            if (onNotice) client.off('notice', onNotice);
            if (previousTimeout !== undefined) {
                try {
                    await client.query(`SELECT set_config('statement_timeout', $1, false),
                        CASE WHEN $2::boolean THEN set_config('app.user_id', NULL, false) END`, [previousTimeout, !!currentUser]);
                }
                catch { discardClient = true; }
            }
            client.release(discardClient || undefined);
        }
    },
};

export default databaseService;
