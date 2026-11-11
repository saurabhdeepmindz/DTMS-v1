import { createKyselyInstance, buildKyselySqlQuery } from './mssql.utils.ts';

global.registerAction('mssql/sql-execute', async ({ args }: ActionParams, context: ActionContext) => {
    const db = createKyselyInstance(context.connection);

    try {
        const query = buildKyselySqlQuery(args.query, args.params);
        const result = await query.execute(db);
        return { rows: result.rows };
    } finally {
        await db.destroy();
    }
});
