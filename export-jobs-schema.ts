import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { jobsSchemaVersion } from './src/jobs/schema-version.ts';

const environments = ['editor', 'staging', 'production'];
const settings = JSON.parse(await readFile('src/data/jobs.json', 'utf8'));
await mkdir('dist', { recursive: true });
for (const environment of environments) {
    if (settings[environment] && settings[environment].schemaVersion !== jobsSchemaVersion) {
        throw new Error('Jobs schema and publisher versions differ; update the publisher before exporting');
    }

    const sql = settings[environment]?.schemaSql;
    if (typeof sql === 'string') {
        await writeFile(`dist/jobs-${environment}.sql`, sql);
    }
}

await writeFile('dist/jobs-schema-version.json', JSON.stringify({ version: jobsSchemaVersion, sharedLambda: true }));
await copyFile('src/jobs/SELF_HOSTING.md', 'dist/JOBS.md');
