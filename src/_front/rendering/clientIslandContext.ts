import { isStaticRenderingActive } from './staticRenderingContext';
import { ClientIslandRenderError, type ClientIslandDiagnosticCategory } from './clientIslandErrors.ts';
import { consumePrerenderClientIslandIds } from './prerenderBootstrap.ts';

export { ClientIslandRenderError } from './clientIslandErrors.ts';

export type ClientIslandType = 'element' | 'section';

export type ClientIslandDiagnostic = {
    id: string;
    componentName?: string;
    category: ClientIslandDiagnosticCategory;
    message?: string;
    stack?: string;
    source?: string;
};

export type ClientIslandRenderResult = {
    clientIslandIds: string[];
    discoveredClientIslandIds: string[];
    diagnostics: ClientIslandDiagnostic[];
};

type CaptureClientIslandErrorOptions = {
    category?: ClientIslandDiagnosticCategory;
    componentName?: string | null;
    phase: string;
};

const MAX_CLIENT_ISLAND_DIAGNOSTICS = 20;

let knownClientIslandIds = new Set(consumePrerenderClientIslandIds());
let discoveredClientIslandIds = new Set<string>();
let diagnostics = new Map<string, ClientIslandDiagnostic>();
let serverRendering = false;

export function createClientIslandId(type: ClientIslandType, uid: string): string {
    return `${type}:${uid}`;
}

export function createClientIslandBaseId(type: ClientIslandType, baseId: string): string {
    return `${type}-base:${baseId}`;
}

/**
 * Starts one isolated SSR attempt. Previously discovered ids are skipped before
 * their component setup executes, which keeps the canonical pass deterministic.
 */
export function prepareClientIslandServerRender(clientIslandIds: string[] = []): void {
    knownClientIslandIds = new Set(clientIslandIds);
    discoveredClientIslandIds = new Set();
    diagnostics = new Map();
    serverRendering = true;
}

export function completeClientIslandServerRender(): ClientIslandRenderResult {
    serverRendering = false;
    return {
        clientIslandIds: [...knownClientIslandIds].sort(),
        discoveredClientIslandIds: [...discoveredClientIslandIds].sort(),
        diagnostics: [...diagnostics.values()],
    };
}

/** Releases the browser-only hydration manifest after the static projection ends. */
export function releaseClientIslandHydrationState(): void {
    knownClientIslandIds.clear();
    discoveredClientIslandIds.clear();
    diagnostics.clear();
}

export function shouldRenderClientIsland(
    clientIslandId: string,
    forceClientOnly: boolean,
    baseClientIslandId: string = clientIslandId
): boolean {
    if (!isStaticRenderingActive()) return false;

    if (serverRendering && forceClientOnly) knownClientIslandIds.add(baseClientIslandId);

    return forceClientOnly || knownClientIslandIds.has(clientIslandId) || knownClientIslandIds.has(baseClientIslandId);
}

export function registerClientIsland(clientIslandId: string): void {
    if (!serverRendering || !isStaticRenderingActive()) return;
    knownClientIslandIds.add(clientIslandId);
}

export function isKnownClientIsland(clientIslandId: string): boolean {
    return serverRendering && isStaticRenderingActive() && knownClientIslandIds.has(clientIslandId);
}

/**
 * Contains descendant setup/render errors only during SSR discovery. Browser
 * runtime errors keep Vue's existing propagation semantics.
 */
export function captureClientIslandError(
    clientIslandId: string,
    error: unknown,
    { category, componentName = null, phase }: CaptureClientIslandErrorOptions
): boolean {
    if (!serverRendering || !isStaticRenderingActive()) return false;

    knownClientIslandIds.add(clientIslandId);
    discoveredClientIslandIds.add(clientIslandId);
    const diagnosticCategory =
        category ?? (error instanceof ClientIslandRenderError ? error.category : 'component-render-error');
    const message = getErrorMessage(error).slice(0, 2000);
    const source = phase.slice(0, 200);
    const diagnosticKey = JSON.stringify([diagnosticCategory, componentName || '', message, source]);

    if (!diagnostics.has(diagnosticKey) && diagnostics.size < MAX_CLIENT_ISLAND_DIAGNOSTICS) {
        diagnostics.set(diagnosticKey, {
            id: clientIslandId,
            ...(componentName ? { componentName } : {}),
            category: diagnosticCategory,
            message,
            stack: getErrorStack(error)?.slice(0, 8000),
            source,
        });
    }
    return true;
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : `${error}`;
}

function getErrorStack(error: unknown): string | undefined {
    return error instanceof Error ? error.stack : undefined;
}
