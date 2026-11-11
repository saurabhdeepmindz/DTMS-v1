import { serve } from '@hono/node-server';
import * as path from 'node:path';
import './core/env.core.js';

// `node index.mjs access:pull`: a self-hosted internal app pulling who can use it from WeWeb, then exiting.
if (process.argv[2] === 'access:pull') {
    const { runAppAccessPull } = await import('./core/appAccessPull.ts');
    process.exit(await runAppAccessPull());
}
// The workspace's private key opens WeWeb's public API for all its projects: the pull's alone, never the server's, whose
// workflows' code could read it.
if (process.env.WEWEB_PRIVATE_KEY) {
    delete process.env.WEWEB_PRIVATE_KEY;
    console.warn("[app-access] WEWEB_PRIVATE_KEY is in the server's environment: give it to `access:pull` only.");
}
import { initializeDataFiles } from './services/dataFiles.service.ts';

await initializeDataFiles(path.resolve(import.meta.dirname, '..'));

const { default: app } = await import('./core/app.core.js');

const PORT = Number.parseInt(process.env.PORT) || 3030;
const server = serve({ fetch: app.fetch, port: PORT }, info =>
    console.log(`Server is running on http://localhost:${info.port}`)
);
const { startJobsLoop } = await import('./jobs/runtime.ts');
const shutdown = new AbortController();
void startJobsLoop(shutdown.signal);
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
        shutdown.abort();
        server.close();
    });
}
