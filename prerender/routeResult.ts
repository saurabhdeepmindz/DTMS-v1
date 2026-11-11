import fs from 'node:fs/promises';
import { isValidClientIslandIdList, MAX_CLIENT_ISLAND_ID_LENGTH, normalizeInitialEnvironment } from './core.ts';
import type { ProcessResult, RouteRenderResult } from './core.ts';

export const MAX_PRERENDERED_APP_HTML_BYTES = 16 * 1024 * 1024;
export const MAX_ROUTE_RENDER_RESULT_BYTES = 20 * 1024 * 1024;

export async function writeRouteRenderResult(resultFile: string, result: RouteRenderResult): Promise<void> {
    const boundedResult = boundRouteRenderResult(result);
    let serializedResult = JSON.stringify(boundedResult);

    if (Buffer.byteLength(serializedResult, 'utf8') > MAX_ROUTE_RENDER_RESULT_BYTES) {
        serializedResult = JSON.stringify(
            createOversizedResult('The serialized route result exceeded its byte budget.')
        );
    }

    await fs.writeFile(resultFile, serializedResult, 'utf8');
}

export async function readRouteRenderResult(
    resultFile: string,
    processResult: ProcessResult
): Promise<RouteRenderResult> {
    if (!processResult.ok) return processResult;

    try {
        const resultStats = await fs.stat(resultFile);
        if (resultStats.size > MAX_ROUTE_RENDER_RESULT_BYTES) {
            return createOversizedResult('The renderer result file exceeded its byte budget.');
        }

        const result: unknown = JSON.parse(await fs.readFile(resultFile, 'utf8'));
        if (!isRouteRenderResult(result)) {
            return {
                ok: false,
                category: 'invalid-result',
                message: 'The static renderer returned an invalid result.',
            };
        }
        if (result.ok && Buffer.byteLength(result.appHtml, 'utf8') > MAX_PRERENDERED_APP_HTML_BYTES) {
            return createOversizedResult('The rendered application HTML exceeded its byte budget.');
        }
        return result;
    } catch (error) {
        return {
            ok: false,
            category: 'missing-result',
            message: getErrorMessage(error),
        };
    }
}

function boundRouteRenderResult(result: RouteRenderResult): RouteRenderResult {
    if (!result.ok) return result;
    if (Buffer.byteLength(result.appHtml, 'utf8') <= MAX_PRERENDERED_APP_HTML_BYTES) return result;

    return createOversizedResult('The rendered application HTML exceeded its byte budget.');
}

function createOversizedResult(message: string): RouteRenderResult {
    return {
        ok: false,
        category: 'render-output-too-large',
        message,
    };
}

function isRouteRenderResult(value: unknown): value is RouteRenderResult {
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, 'ok')) return false;

    const result = value as Record<string, unknown>;
    if (result.ok === true) {
        return (
            typeof result.appHtml === 'string' &&
            (result.runtimeCss === undefined || typeof result.runtimeCss === 'string') &&
            (result.clientIslands === undefined || isClientIslandRenderResult(result.clientIslands)) &&
            (result.initialEnvironment === undefined || !!normalizeInitialEnvironment(result.initialEnvironment))
        );
    }
    return (
        result.ok === false &&
        typeof result.category === 'string' &&
        (result.message === undefined || typeof result.message === 'string') &&
        (result.stack === undefined || typeof result.stack === 'string')
    );
}

function isClientIslandRenderResult(value: unknown): boolean {
    if (!value || typeof value !== 'object') return false;

    const result = value as Record<string, unknown>;
    return (
        isValidClientIslandIdList(result.clientIslandIds) &&
        isValidClientIslandIdList(result.discoveredClientIslandIds) &&
        Array.isArray(result.diagnostics) &&
        result.diagnostics.every(isClientIslandDiagnostic)
    );
}

function isClientIslandDiagnostic(value: unknown): boolean {
    if (!value || typeof value !== 'object') return false;

    const diagnostic = value as Record<string, unknown>;
    return (
        typeof diagnostic.id === 'string' &&
        diagnostic.id.length > 0 &&
        diagnostic.id.length <= MAX_CLIENT_ISLAND_ID_LENGTH &&
        typeof diagnostic.category === 'string' &&
        (diagnostic.message === undefined || typeof diagnostic.message === 'string') &&
        (diagnostic.stack === undefined || typeof diagnostic.stack === 'string') &&
        (diagnostic.componentName === undefined || typeof diagnostic.componentName === 'string') &&
        (diagnostic.source === undefined || typeof diagnostic.source === 'string')
    );
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : `${error}`;
}
