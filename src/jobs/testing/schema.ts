import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);

const backendJobsDirectory = resolve(import.meta.dirname, '../../../../../weweb-back/core/back/jobs');

// Load lazily: exported runtime tests may provide JOBS_TEST_SCHEMA_SQL without the monorepo.
function backendSchema() {
    return require(resolve(backendJobsDirectory, 'schema.js'));
}

export async function resetSchema(client: { query: (sql: string) => Promise<unknown> }) {
    await client.query(String.raw`DO $$
DECLARE signature regprocedure;
BEGIN
    FOR signature IN
        SELECT p.oid::regprocedure
        FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname LIKE 'jobs\_%'
    LOOP
        EXECUTE format('DROP FUNCTION %s', signature);
    END LOOP;
END $$;
DROP SCHEMA IF EXISTS jobs, jobs_staging, jobs_production CASCADE;`);
}

/** Integration tests consume the real rendered migration bundle from the backend service. */
export async function schemaSql(): Promise<string> {
    if (process.env.JOBS_TEST_SCHEMA_SQL) {
        return readFile(process.env.JOBS_TEST_SCHEMA_SQL, 'utf8');
    }

    return backendSchema().renderJobsSchema();
}

export async function upgradedSchema(sql: string): Promise<string> {
    const backend = backendSchema();
    const sources = await Promise.all(
        backend.jobsMigrationFiles.map((file: string) => readFile(resolve(backendJobsDirectory, file), 'utf8'))
    );
    return backend.renderMigrations([...sources, sql]);
}
