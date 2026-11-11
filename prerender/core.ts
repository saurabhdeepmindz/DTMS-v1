const APP_MOUNT_POINT = '<div id="app" data-ww-app-mount="true"></div>';
const BUILD_ASSET_PREFIX_MARKER = '<meta name="ww-build-asset-prefix" content="';
export const PRERENDERED_RUNTIME_STYLE_ATTRIBUTE = 'data-ww-style-compiler-prerendered';
export const MAX_CLIENT_ISLAND_IDS = 100_000;
export const MAX_CLIENT_ISLAND_ID_LENGTH = 256;

export type PrerenderRoute = {
    pageId: string;
    url: string;
    lang: string;
    htmlFile: string;
    preferred: boolean;
    eligible: boolean;
};

export type PrerenderManifest = {
    version: 1;
    configuredRouteCount?: number;
    eligibleRouteCount?: number;
    routes: PrerenderRoute[];
    staticFormulas?: StaticFormulaProjectionStats;
};

export type StaticFormulaUnresolvedReason =
    | 'unsupported-type'
    | 'unsupported-feature'
    | 'missing-context'
    | 'invalid-code'
    | 'budget-exceeded'
    | 'executor-unavailable'
    | 'evaluation-error';

export type StaticFormulaProjectionStats = {
    discovered: number;
    explicit: number;
    resolved: number;
    unresolved: number;
    unresolvedByReason: Record<StaticFormulaUnresolvedReason, number>;
    rejected: number;
    removed: number;
    removedByPageBudget: number;
};

export type ClientBuildManifestChunk = {
    file: string;
    src?: string;
    css?: string[];
    imports?: string[];
};

export type ClientBuildManifest = Record<string, ClientBuildManifestChunk>;

export type ClientIslandAttempt = {
    clientIslandIds?: string[];
    discoveredClientIslandIds?: string[];
};

export type ProcessResult =
    | {
          ok: true;
          message?: string;
      }
    | {
          ok: false;
          category: string;
          message?: string;
      };

export type ProcessTerminationCategory = 'deadline' | 'process-timeout';

export type Diagnostic = {
    category: string;
    message?: string;
    stack?: string;
};

export type ClientIslandDiagnostic = Diagnostic & {
    id: string;
    componentName?: string;
    category: string;
    source?: string;
};

export type ClientIslandRenderResult = {
    clientIslandIds: string[];
    discoveredClientIslandIds: string[];
    diagnostics: ClientIslandDiagnostic[];
};

export type RouteRenderResult =
    | {
          ok: true;
          appHtml: string;
          runtimeCss?: string;
          clientIslands?: ClientIslandRenderResult;
          initialEnvironment?: unknown;
      }
    | ({ ok: false } & Diagnostic);

type InitialEnvironment = {
    version: 1;
    randomSeed: number;
    timestamp: number;
    performanceNow: number;
    viewport: {
        innerWidth: number;
        innerHeight: number;
        devicePixelRatio: number;
    };
};

export function getPrerenderCandidates(manifest: PrerenderManifest): PrerenderRoute[] {
    return (manifest?.routes || []).filter(route => route.preferred && route.eligible);
}

export function getPrerenderRouteCounts(
    manifest: PrerenderManifest,
    candidates = getPrerenderCandidates(manifest)
): { configured: number; eligible: number } {
    return {
        configured: getNonNegativeInteger(
            manifest.configuredRouteCount,
            manifest.routes.filter(route => route.preferred).length
        ),
        eligible: getNonNegativeInteger(manifest.eligibleRouteCount, candidates.length),
    };
}

export function reconcileClientIslandAttempt(
    knownClientIslandIds: string[],
    attempt: ClientIslandAttempt | undefined
): { clientIslandIds: string[]; shouldRetry: boolean; limitExceeded: boolean } {
    const clientIslandIds = new Set<string>();
    for (const id of knownClientIslandIds) {
        clientIslandIds.add(id);
        if (clientIslandIds.size > MAX_CLIENT_ISLAND_IDS) {
            return { clientIslandIds: [], shouldRetry: false, limitExceeded: true };
        }
    }
    for (const id of attempt?.clientIslandIds || []) {
        clientIslandIds.add(id);
        if (clientIslandIds.size > MAX_CLIENT_ISLAND_IDS) {
            return { clientIslandIds: [], shouldRetry: false, limitExceeded: true };
        }
    }

    return {
        clientIslandIds: [...clientIslandIds].sort(),
        shouldRetry: !!attempt?.discoveredClientIslandIds?.length,
        limitExceeded: false,
    };
}

export function isValidClientIslandIdList(value: unknown): value is string[] {
    return (
        Array.isArray(value) &&
        value.length <= MAX_CLIENT_ISLAND_IDS &&
        value.every(item => typeof item === 'string' && item.length > 0 && item.length <= MAX_CLIENT_ISLAND_ID_LENGTH)
    );
}

export function getRouteCssFiles(manifest: ClientBuildManifest, pageId: string): string[] {
    const pageSource = `src/pages/${pageId.split('_')[0]}.js`;
    const pageChunkKey = Object.entries(manifest).find(
        ([key, chunk]) => normalizeSourcePath(chunk.src || key) === pageSource
    )?.[0];
    if (!pageChunkKey) {
        throw new Error(`Unable to find the client build chunk for page: ${pageId}`);
    }

    const visitedChunks = new Set<string>();
    const cssFiles = new Set<string>();

    const collectChunkCss = (chunkKey: string): void => {
        if (visitedChunks.has(chunkKey)) return;
        visitedChunks.add(chunkKey);

        const chunk = manifest[chunkKey];
        if (!chunk) {
            throw new Error(`Unable to find the imported client build chunk: ${chunkKey}`);
        }

        for (const importedChunkKey of chunk.imports || []) {
            collectChunkCss(importedChunkKey);
        }
        for (const cssFile of chunk.css || []) {
            cssFiles.add(cssFile);
        }
    };

    collectChunkCss(pageChunkKey);
    return [...cssFiles];
}

export function enrichRouteHtml(
    baselineHtml: string,
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
): string {
    if (!baselineHtml.includes(APP_MOUNT_POINT)) {
        throw new Error(`Unable to find the CSR mount point: ${APP_MOUNT_POINT}`);
    }
    if (baselineHtml.indexOf(APP_MOUNT_POINT) !== baselineHtml.lastIndexOf(APP_MOUNT_POINT)) {
        throw new Error('The CSR mount point is ambiguous.');
    }
    if ((cssFiles.length || runtimeCss) && !baselineHtml.includes('</head>')) {
        throw new Error('Unable to find the document head closing tag.');
    }
    if (!isValidClientIslandIdList(clientIslandIds)) {
        throw new Error('Client-island identifiers exceeded the pre-render protocol limits.');
    }

    const normalizedInitialEnvironment = normalizeInitialEnvironment(initialEnvironment);
    if (initialEnvironment !== undefined && !normalizedInitialEnvironment) {
        throw new Error('The initial hydration environment is invalid.');
    }

    const serializedClientIslands = escapeHtmlAttribute(JSON.stringify(clientIslandIds));
    const serializedInitialEnvironment = escapeHtmlAttribute(JSON.stringify(normalizedInitialEnvironment || null));
    const buildAssetPrefix = getBuildAssetPrefix(baselineHtml);
    const stylesheets = cssFiles
        .map(cssFile => `<link rel="stylesheet" href="${escapeHtmlAttribute(`${buildAssetPrefix}${cssFile}`)}" />`)
        .join('');
    const prerenderedRuntimeStyle = runtimeCss
        ? `<style ${PRERENDERED_RUNTIME_STYLE_ATTRIBUTE}>${escapeStyleElementText(runtimeCss)}</style>`
        : '';
    const injectedStyles = `${stylesheets}${prerenderedRuntimeStyle}`;
    const htmlWithStyles = injectedStyles ? baselineHtml.replace('</head>', `${injectedStyles}</head>`) : baselineHtml;

    return htmlWithStyles.replace(
        APP_MOUNT_POINT,
        `<div id="app" data-ww-prerendered="true" data-ww-client-islands="${serializedClientIslands}" data-ww-initial-environment="${serializedInitialEnvironment}">${appHtml}</div>`
    );
}

export function normalizeInitialEnvironment(value: unknown): InitialEnvironment | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;

    const environment = value as Partial<InitialEnvironment>;
    if (environment.version !== 1) return;
    if (!isUint32(environment.randomSeed)) return;
    if (!isValidDateTimestamp(environment.timestamp)) return;
    if (!isNonNegativeFiniteNumber(environment.performanceNow)) return;
    if (!environment.viewport || typeof environment.viewport !== 'object') return;
    if (!isNonNegativeFiniteNumber(environment.viewport.innerWidth)) return;
    if (!isNonNegativeFiniteNumber(environment.viewport.innerHeight)) return;
    if (!isNonNegativeFiniteNumber(environment.viewport.devicePixelRatio)) return;

    return {
        version: 1,
        randomSeed: environment.randomSeed,
        timestamp: environment.timestamp,
        performanceNow: environment.performanceNow,
        viewport: {
            innerWidth: environment.viewport.innerWidth,
            innerHeight: environment.viewport.innerHeight,
            devicePixelRatio: environment.viewport.devicePixelRatio,
        },
    };
}

export function classifyProcessExit(
    code: number | null,
    terminationCategory?: ProcessTerminationCategory
): ProcessResult {
    if (terminationCategory) return { ok: false, category: terminationCategory };
    if (code === 0) {
        return { ok: true };
    }
    return { ok: false, category: 'process-error' };
}

function normalizeSourcePath(source: string): string {
    return source.replace(/^\.?\//, '');
}

function getNonNegativeInteger(value: number | undefined, fallback: number): number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}

function isUint32(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 0xffff_ffff;
}

function isValidDateTimestamp(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && !Number.isNaN(new Date(value).getTime());
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function escapeHtmlAttribute(value: string): string {
    return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function escapeStyleElementText(value: string): string {
    return value.replaceAll('<', '\\3C ');
}

export function getBuildAssetPrefix(html: string): string {
    const markerIndex = html.indexOf(BUILD_ASSET_PREFIX_MARKER);
    if (markerIndex === -1 || markerIndex !== html.lastIndexOf(BUILD_ASSET_PREFIX_MARKER)) {
        throw new Error('Unable to find one unambiguous build asset prefix marker.');
    }

    const prefixStart = markerIndex + BUILD_ASSET_PREFIX_MARKER.length;
    const prefixEnd = html.indexOf('" />', prefixStart);
    if (prefixEnd === -1) {
        throw new Error('The build asset prefix marker is malformed.');
    }
    try {
        return decodeURIComponent(html.slice(prefixStart, prefixEnd));
    } catch {
        throw new Error('The build asset prefix marker is malformed.');
    }
}
