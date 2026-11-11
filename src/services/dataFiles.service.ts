import { promises as fs } from 'fs';
import * as path from 'path';

async function ensureDataDirectory(dataDir: string) {
    try {
        await fs.access(dataDir);
    } catch {
        await fs.mkdir(dataDir, { recursive: true });
    }
}

async function ensureDataFile(dataDir: string, filename: string, defaultContent: unknown) {
    const dataFile = path.join(dataDir, filename);
    try {
        await fs.access(dataFile);
    } catch {
        await fs.writeFile(dataFile, JSON.stringify(defaultContent, null, 2), 'utf8');
    }
}

export async function initializeDataFiles(serverRoot: string) {
    const dataDir = path.resolve(serverRoot, './src/data');
    await ensureDataDirectory(dataDir);
    await ensureDataFile(dataDir, 'connections.json', {});
    await ensureDataFile(dataDir, 'integrationTables.json', {});
    await ensureDataFile(dataDir, 'pages.json', {});
    await ensureDataFile(dataDir, 'tableViews.json', {});
    await ensureDataFile(dataDir, 'workflows.json', []);
    await ensureDataFile(dataDir, 'jobs.json', {});
    await ensureDataFile(dataDir, 'databaseSchema.json', { tables: {} });
    await ensureDataFile(dataDir, 'tableFormulaColumns.json', {});
    await ensureDataFile(dataDir, 'formulaEnvironmentNames.json', []);
    await ensureDataFile(dataDir, 'authUsersColumns.json', { columns: [], reservedColumnNames: [] });
}
