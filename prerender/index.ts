import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    getPrerenderCandidates,
    getPrerenderRouteCounts,
    getRouteCssFiles,
    reconcileClientIslandAttempt,
} from './core.ts';
import { withPrerenderAttemptFiles } from './workFiles.ts';
import { createRendererSandbox } from './rendererSandbox.ts';
import { createNodeBuiltinsImportMap } from './nodeBuiltinsImportMap.ts';
import { createProcessSupervisor } from './processSupervisor.ts';
import { createProcessRunner } from './processRunner.ts';
import { readRouteRenderResult } from './routeResult.ts';
import { createPrerenderedRouteHtml, readRouteBuildAssetPrefix } from './routeHtml.ts';
import { addRouteReport, createPrerenderReport, createRouteReport, omitRouteReports } from './report.ts';
import { createPrerenderFinalizer } from './finalization.ts';
import { createPrerenderTerminationCoordinator } from './terminationCoordinator.ts';
import type {
    ClientBuildManifest,
    ClientIslandDiagnostic,
    Diagnostic,
    PrerenderManifest,
    PrerenderRoute,
    ProcessResult,
    RouteRenderResult,
} from './core.ts';

const frontRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(frontRoot, '.ww-prerender-manifest.json');
const clientManifestPath = path.join(frontRoot, 'dist', '.ww-client-manifest.json');
const reportPath = path.join(frontRoot, '.weweb', 'prerender-report.json');
const workPath = path.join(frontRoot, '.weweb', 'prerender-work');
const nodeBuiltinsImportMapPath = path.join(workPath, 'node-builtins-import-map.json');
const deadline = Number.parseInt(process.env.WW_PRERENDER_DEADLINE_EPOCH_MS || '', 10) || null;
const MAX_CLIENT_ISLAND_RENDER_ATTEMPTS = 10;
const MAX_CLIENT_ISLAND_DIAGNOSTICS = 20;
const ROUTE_RENDER_TIMEOUT_MS = readPositiveInteger('WW_PRERENDER_ROUTE_TIMEOUT_MS', 30_000);
const SSR_BUILD_MAX_OLD_SPACE_SIZE_MB = readBoundedPositiveInteger(
    'WW_PRERENDER_SSR_BUILD_MAX_OLD_SPACE_SIZE_MB',
    2_048,
    4_096
);
const SSR_BUILD_MAX_OUTPUT_BYTES = readBoundedPositiveInteger(
    'WW_PRERENDER_SSR_BUILD_MAX_OUTPUT_BYTES',
    64 * 1024,
    1024 * 1024
);
let clientBuildManifest: ClientBuildManifest | null = null;
let candidates: PrerenderRoute[] = [];
let nextRouteIndex = 0;
const report = createPrerenderReport();
const processSupervisor = createProcessSupervisor();
const runProcess = createProcessRunner({
    cwd: frontRoot,
    deadline,
    defaultEnvironment: {
        ...process.env,
        VITE_CJS_IGNORE_WARNING: 'true',
    },
    supervisor: processSupervisor,
});
const finalize = createPrerenderFinalizer({
    clientManifestPath,
    report,
    reportPath,
    workPath,
    terminateProcesses: processSupervisor.terminateAll,
    logResourceUsage: () => logResourceUsage('rendering-complete'),
});
const termination = createPrerenderTerminationCoordinator({
    terminateActiveProcesses: processSupervisor.terminateAll,
    warn: error => {
        console.warn('[weweb-prerender] unable to terminate active processes after signal', {
            message: getErrorMessage(error),
        });
    },
});
const handleTermination = (): void => {
    termination.request();
};
process.on('SIGINT', handleTermination);
process.on('SIGTERM', handleTermination);

try {
    await fs.mkdir(workPath, { recursive: true });
    await fs.writeFile(nodeBuiltinsImportMapPath, JSON.stringify(createNodeBuiltinsImportMap()), 'utf8');
    if (termination.isRequested()) throw createTerminationError();
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as PrerenderManifest;
    candidates = getPrerenderCandidates(manifest);
    const routeCounts = getPrerenderRouteCounts(manifest, candidates);
    report.staticFormulas = manifest.staticFormulas;
    report.totals.configured = routeCounts.configured;
    report.totals.eligible = routeCounts.eligible;
    logResourceUsage('route-plan-created');

    if (candidates.length && !termination.isRequested()) {
        if (isDeadlineReached()) {
            skipRoutesAtDeadline(candidates.length);
        } else {
            clientBuildManifest = JSON.parse(await fs.readFile(clientManifestPath, 'utf8')) as ClientBuildManifest;
            if (termination.isRequested()) throw createTerminationError();
            const serverBuild = await runViteBuild([
                'build',
                '--ssr',
                'src/_front/entry-server.ts',
                '--outDir',
                'dist-ssr',
                '-l',
                'warn',
            ]);

            if (termination.isRequested()) {
                // The owning campaign accounts the unfinished routes after the active process settles.
            } else if (!serverBuild.ok && serverBuild.category === 'deadline') {
                skipRoutesAtDeadline(candidates.length);
            } else if (!serverBuild.ok) {
                fallbackAllRoutes(candidates.length, {
                    category: 'renderer-build-error',
                    message: serverBuild.message,
                });
            } else {
                while (nextRouteIndex < candidates.length) {
                    if (termination.isRequested()) break;
                    if (isDeadlineReached()) {
                        skipRoutesAtDeadline(candidates.length - nextRouteIndex);
                        break;
                    }

                    const route = candidates[nextRouteIndex];
                    await renderRoute(route, nextRouteIndex);
                    nextRouteIndex++;
                    if (termination.isRequested()) break;
                }
            }
        }
    }
} catch (error) {
    if (!termination.isRequested()) {
        fallbackAllRoutes(candidates.length - nextRouteIndex, {
            category: 'renderer-error',
            message: getErrorMessage(error),
            stack: getErrorStack(error)?.slice(0, 8000),
        });
    }
} finally {
    const wasTerminated = await termination.complete({
        accountUnprocessedRoutes: accountUnprocessedRoutesAtTermination,
        finalize,
    });
    process.removeListener('SIGINT', handleTermination);
    process.removeListener('SIGTERM', handleTermination);
    if (wasTerminated) process.exitCode = 1;
}

async function renderRoute(route: PrerenderRoute, index: number): Promise<void> {
    const candidateFile = path.join(workPath, `${index}-candidate.html`);
    const baselineFile = path.join(frontRoot, 'dist', route.htmlFile);
    let publicUrlPrefix: string;
    try {
        const buildAssetPrefix = await readRouteBuildAssetPrefix(baselineFile);
        if (termination.isRequested()) return;
        if (!buildAssetPrefix.ok) {
            fallbackRoute(route, buildAssetPrefix.diagnostic);
            return;
        }
        publicUrlPrefix = buildAssetPrefix.prefix;
    } catch (error) {
        if (termination.isRequested()) return;
        fallbackRoute(route, {
            category: 'baseline-read-error',
            message: getErrorMessage(error),
        });
        return;
    }

    const renderResult = await renderCanonicalRoute(route, index, publicUrlPrefix);
    if (termination.isRequested()) return;
    if (!renderResult.ok) {
        if (renderResult.category === 'deadline') {
            skipRoutesAtDeadline(1);
            return;
        }
        fallbackRoute(route, renderResult);
        return;
    }
    if (typeof renderResult.appHtml !== 'string') {
        fallbackRoute(route, {
            category: 'missing-render-output',
            message: 'The static renderer did not return app HTML.',
        });
        return;
    }

    try {
        if (!clientBuildManifest) {
            throw new Error('The client build manifest is unavailable.');
        }
        const candidate = await createPrerenderedRouteHtml(baselineFile, {
            appHtml: renderResult.appHtml,
            cssFiles: getRouteCssFiles(clientBuildManifest, route.pageId),
            clientIslandIds: renderResult.clientIslands?.clientIslandIds,
            initialEnvironment: renderResult.initialEnvironment,
            runtimeCss: renderResult.runtimeCss,
        });
        if (!candidate.ok) {
            fallbackRoute(route, candidate.diagnostic);
            return;
        }
        if (termination.isRequested()) return;
        await fs.writeFile(candidateFile, candidate.html, 'utf8');
        if (termination.isRequested()) {
            await fs.rm(candidateFile, { force: true });
            return;
        }
    } catch (error) {
        if (termination.isRequested()) return;
        fallbackRoute(route, {
            category: 'candidate-write-error',
            message: getErrorMessage(error),
        });
        return;
    }

    try {
        if (termination.isRequested()) return;
        await fs.rename(candidateFile, baselineFile);
    } catch (error) {
        if (termination.isRequested()) return;
        fallbackRoute(route, {
            category: 'candidate-commit-error',
            message: getErrorMessage(error),
        });
        return;
    }
    report.totals.rendered++;
    report.totals.clientIslands += renderResult.clientIslands?.clientIslandIds.length || 0;
    const clientIslandDiagnostics = renderResult.clientIslands?.diagnostics || [];
    if (clientIslandDiagnostics.length) {
        addRouteReport(
            report,
            createRouteReport(route, 'rendered', {
                clientIslands: clientIslandDiagnostics,
            })
        );
    }
}

async function renderCanonicalRoute(
    route: PrerenderRoute,
    index: number,
    publicUrlPrefix: string
): Promise<RouteRenderResult> {
    let clientIslandIds: string[] = [];
    const diagnostics = new Map<string, ClientIslandDiagnostic>();

    for (let attempt = 0; attempt < MAX_CLIENT_ISLAND_RENDER_ATTEMPTS; attempt++) {
        if (termination.isRequested()) return createTerminationResult();
        const renderResult = await withPrerenderAttemptFiles(
            {
                workPath,
                routeIndex: index,
                attempt,
                input: { ...route, clientIslandIds, publicUrlPrefix },
            },
            async ({ routeFile, resultFile }) => {
                if (termination.isRequested()) return createTerminationResult();
                const renderProcess = await runRouteRenderer(routeFile, resultFile);
                return readRouteRenderResult(resultFile, renderProcess);
            }
        );
        if (termination.isRequested()) return createTerminationResult();
        if (!renderResult.ok) return renderResult;

        const clientIslands = renderResult.clientIslands;
        for (const diagnostic of clientIslands?.diagnostics || []) {
            if (diagnostics.size >= MAX_CLIENT_ISLAND_DIAGNOSTICS) break;

            const diagnosticKey = JSON.stringify([
                diagnostic.category,
                diagnostic.componentName || '',
                diagnostic.message || '',
                diagnostic.source || '',
            ]);
            if (!diagnostics.has(diagnosticKey)) diagnostics.set(diagnosticKey, diagnostic);
        }

        const reconciliation = reconcileClientIslandAttempt(clientIslandIds, clientIslands);
        if (reconciliation.limitExceeded) {
            return {
                ok: false,
                category: 'client-island-limit-exceeded',
                message: 'The route exceeded the client-island identifier limit.',
            };
        }
        if (!reconciliation.shouldRetry) {
            return {
                ...renderResult,
                clientIslands: {
                    clientIslandIds: reconciliation.clientIslandIds,
                    discoveredClientIslandIds: [],
                    diagnostics: [...diagnostics.values()],
                },
            };
        }

        clientIslandIds = reconciliation.clientIslandIds;
    }

    return {
        ok: false,
        category: 'client-island-stabilization-error',
        message: `Unable to stabilize client islands after ${MAX_CLIENT_ISLAND_RENDER_ATTEMPTS} attempts.`,
    };
}

function createTerminationResult(): RouteRenderResult {
    return {
        ok: false,
        category: 'renderer-terminated',
        message: 'Static rendering was terminated.',
    };
}

function createTerminationError(): Error {
    return new Error('Static rendering was terminated.');
}

function skipRoutesAtDeadline(count: number): void {
    report.status = 'deadline-reached';
    report.totals.deadlineSkipped += count;
    omitRouteReports(report, count);
}

function fallbackRoute(route: PrerenderRoute, diagnostic: Diagnostic): void {
    console.warn('[weweb-prerender] route fallback', {
        pageId: route.pageId,
        lang: route.lang,
        category: diagnostic.category,
        message: diagnostic.message,
    });
    report.totals.fallback++;
    addRouteReport(report, createRouteReport(route, 'csr-fallback', { diagnostic }));
}

function fallbackAllRoutes(count: number, diagnostic: Diagnostic): void {
    console.warn('[weweb-prerender] global fallback', {
        affectedRouteCount: count,
        category: diagnostic.category,
        message: diagnostic.message,
    });
    report.status = 'renderer-fallback';
    report.totals.fallback += count;
    addRouteReport(report, {
        status: 'global-fallback',
        diagnostic,
    });
}

function accountUnprocessedRoutesAtTermination(): void {
    const accountedRoutes = report.totals.rendered + report.totals.fallback + report.totals.deadlineSkipped;
    const unaccountedRoutes = Math.max(report.totals.eligible - accountedRoutes, 0);
    if (!unaccountedRoutes) return;

    if (isDeadlineReached()) {
        skipRoutesAtDeadline(unaccountedRoutes);
        return;
    }

    fallbackAllRoutes(unaccountedRoutes, {
        category: 'renderer-terminated',
        message: 'Static rendering was terminated before all eligible routes were processed.',
    });
}

function isDeadlineReached(): boolean {
    return deadline !== null && Date.now() >= deadline;
}

async function runViteBuild(args: string[]): Promise<ProcessResult> {
    const vite = path.join(frontRoot, 'node_modules', 'vite', 'bin', 'vite.js');
    return runProcess(process.execPath, [`--max-old-space-size=${SSR_BUILD_MAX_OLD_SPACE_SIZE_MB}`, vite, ...args], {
        maxOutputBytes: SSR_BUILD_MAX_OUTPUT_BYTES,
        output: 'capture',
    });
}

async function runRouteRenderer(routeFile: string, resultFile: string): Promise<ProcessResult> {
    const sandbox = createRendererSandbox({
        importMapPath: nodeBuiltinsImportMapPath,
        readPaths: [
            routeFile,
            path.join(frontRoot, 'package.json'),
            path.join(frontRoot, 'prerender'),
            path.join(frontRoot, 'dist-ssr'),
            path.join(frontRoot, 'public'),
            path.join(frontRoot, 'node_modules'),
        ],
        resultFile,
        scriptPath: path.join(frontRoot, 'prerender', 'renderRoute.ts'),
        scriptArguments: [frontRoot, routeFile, resultFile],
    });
    return runProcess(sandbox.command, sandbox.arguments, {
        environment: sandbox.environment,
        output: 'ignore',
        timeoutMs: ROUTE_RENDER_TIMEOUT_MS,
    });
}

function logResourceUsage(phase: string): void {
    const memory = process.memoryUsage();
    console.log('[weweb-prerender] resource usage', {
        phase,
        configuredRouteCount: report.totals.configured,
        eligibleRouteCount: report.totals.eligible,
        processedRouteCount: nextRouteIndex,
        routeDetailCount: report.routes.length,
        routeDetailsOmitted: report.totals.routeDetailsOmitted,
        rssBytes: memory.rss,
        heapUsedBytes: memory.heapUsed,
        heapTotalBytes: memory.heapTotal,
        externalBytes: memory.external,
        arrayBuffersBytes: memory.arrayBuffers,
    });
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : `${error}`;
}

function getErrorStack(error: unknown): string | undefined {
    return error instanceof Error ? error.stack : undefined;
}

function readPositiveInteger(name: string, fallback: number): number {
    const value = Number.parseInt(process.env[name] || '', 10);
    return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function readBoundedPositiveInteger(name: string, fallback: number, maximum: number): number {
    return Math.min(readPositiveInteger(name, fallback), maximum);
}
