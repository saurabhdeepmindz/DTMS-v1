import fs from 'node:fs/promises';
import { enrichRouteHtml, getBuildAssetPrefix } from './core.ts';
import type { Diagnostic } from './core.ts';

export const MAX_PRERENDERED_ROUTE_HTML_BYTES = 32 * 1024 * 1024;

type PrerenderFailure = { ok: false; diagnostic: Diagnostic };
type PrerenderedRouteHtmlResult = { ok: true; html: string } | PrerenderFailure;
type RouteBuildAssetPrefixResult = { ok: true; prefix: string } | PrerenderFailure;

export async function readRouteBuildAssetPrefix(baselineFile: string): Promise<RouteBuildAssetPrefixResult> {
    const baselineStats = await fs.stat(baselineFile);
    if (baselineStats.size > MAX_PRERENDERED_ROUTE_HTML_BYTES) return createOversizedRouteResult();

    const baselineHtml = await fs.readFile(baselineFile, 'utf8');
    return { ok: true, prefix: getBuildAssetPrefix(baselineHtml) };
}

export async function createPrerenderedRouteHtml(
    baselineFile: string,
    {
        appHtml,
        cssFiles = [],
        clientIslandIds = [],
        initialEnvironment,
        runtimeCss = '',
    }: {
        appHtml: string;
        cssFiles?: string[];
        clientIslandIds?: string[];
        initialEnvironment?: unknown;
        runtimeCss?: string;
    }
): Promise<PrerenderedRouteHtmlResult> {
    const baselineStats = await fs.stat(baselineFile);
    const appHtmlBytes = Buffer.byteLength(appHtml, 'utf8');
    const runtimeCssBytes = Buffer.byteLength(runtimeCss, 'utf8');
    if (baselineStats.size + appHtmlBytes + runtimeCssBytes > MAX_PRERENDERED_ROUTE_HTML_BYTES) {
        return createOversizedRouteResult();
    }

    const baselineHtml = await fs.readFile(baselineFile, 'utf8');
    const html = enrichRouteHtml(baselineHtml, {
        appHtml,
        cssFiles,
        clientIslandIds,
        initialEnvironment,
        runtimeCss,
    });
    if (Buffer.byteLength(html, 'utf8') > MAX_PRERENDERED_ROUTE_HTML_BYTES) {
        return createOversizedRouteResult();
    }

    return { ok: true, html };
}

function createOversizedRouteResult(): PrerenderFailure {
    return {
        ok: false,
        diagnostic: {
            category: 'route-output-too-large',
            message: 'The complete pre-rendered route HTML exceeded its byte budget.',
        },
    };
}
