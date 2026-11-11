import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';

export function createKyselyInstance(connection: ConnectionConfig) {
    return new Kysely({
        dialect: new PostgresDialect({
            pool: new Pool({
                host: connection?.host,
                port: parseInt(connection?.port) || 5432,
                database: connection?.database,
                user: connection?.user,
                password: connection?.password,
                ssl: createSslConfig(connection),
            }),
        }),
    });
}

export function buildKyselySqlQuery(query: string, parameters: Record<string, any> = {}) {
    const params = parameters || {};
    const paramRegex = /\$([a-zA-Z0-9_]*)/g;
    const matches = [...query.matchAll(paramRegex)];
    if (matches.length === 0) return sql.raw(query);

    const parts = [];
    let lastIndex = 0;

    for (const match of matches) {
        const paramName = match[1];
        const matchStart = match.index;

        const sqlFragment = query.slice(lastIndex, matchStart);
        if (sqlFragment) {
            parts.push(sql.raw(sqlFragment));
        }

        if (!(paramName in params)) {
            throw new Error(`Missing parameter: $${paramName}`);
        }

        parts.push(params[paramName]);
        lastIndex = matchStart + match[0].length;
    }

    const remainingSQL = query.slice(lastIndex);
    if (remainingSQL) {
        parts.push(sql.raw(remainingSQL));
    }

    return sql.join(parts, sql``);
}

function createSslConfig(connection: ConnectionConfig) {
    switch (connection.ssl) {
        case 'PREFERRED':
            return { rejectUnauthorized: false };
        case 'REQUIRED':
            return { rejectUnauthorized: true };
        case 'DISABLED':
            return false;
    }
    return undefined;
}
