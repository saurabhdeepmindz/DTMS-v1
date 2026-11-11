import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createNetworklessDom } from './domEnvironment.ts';
import { writeRouteRenderResult } from './routeResult.ts';
import type { ClientIslandRenderResult, PrerenderRoute, RouteRenderResult } from './core.ts';

type RenderRouteInput = PrerenderRoute & {
    clientIslandIds?: string[];
    publicUrlPrefix?: string;
};

const [frontRoot, routeFile, resultFile] = process.argv.slice(2);
if (!frontRoot || !routeFile || !resultFile) {
    throw new Error('Expected front root, route file, and result file arguments.');
}

const route = JSON.parse(await fs.readFile(routeFile, 'utf8')) as RenderRouteInput;
const environment = createNetworklessDom(
    '<!doctype html><html><head></head><body><div id="app"></div></body></html>',
    new URL(route.url, 'http://weweb.local').href,
    {
        publicPath: path.join(frontRoot, 'public'),
        publicUrlPrefix: route.publicUrlPrefix,
    }
);

try {
    const serverEntry = pathToFileURL(path.join(frontRoot, 'dist-ssr', 'entry-server.js')).href;
    const { render } = (await import(serverEntry)) as {
        render: (
            url: string,
            clientIslandIds?: string[]
        ) => Promise<{
            appHtml: string;
            clientIslands: ClientIslandRenderResult;
            initialEnvironment?: unknown;
            runtimeCss?: string;
        }>;
    };
    const result: RouteRenderResult = {
        ok: true,
        ...(await render(route.url, route.clientIslandIds)),
    };
    await writeRouteRenderResult(resultFile, result);
} catch (error) {
    const result: RouteRenderResult = {
        ok: false,
        category: 'render-error',
        message: getErrorMessage(error).slice(0, 2000),
        stack: getErrorStack(error)?.slice(0, 8000),
    };
    await writeRouteRenderResult(resultFile, result);
} finally {
    environment.dispose();
}

process.exit(0);

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : `${error}`;
}

function getErrorStack(error: unknown): string | undefined {
    return error instanceof Error ? error.stack : undefined;
}
