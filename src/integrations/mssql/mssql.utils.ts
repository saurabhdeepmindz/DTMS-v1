import { Kysely, MssqlDialect, sql } from 'kysely';
import Tedious from 'tedious';
import Tarn from 'tarn';

export function createKyselyInstance(connection: ConnectionConfig) {
    return new Kysely({
        dialect: new MssqlDialect({
            tarn: {
                ...Tarn,
                options: {
                    min: 0,
                    max: 10,
                },
            },
            tedious: {
                ...Tedious,
                connectionFactory: () =>
                    new Tedious.Connection({
                        authentication: {
                            options: {
                                password: connection?.password,
                                userName: connection?.user,
                            },
                            type: 'default',
                        },
                        options: {
                            database: connection?.database,
                            port: parseInt(connection?.port) || 1433,
                            trustServerCertificate: true,
                        },
                        server: connection?.host,
                    }),
            },
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
