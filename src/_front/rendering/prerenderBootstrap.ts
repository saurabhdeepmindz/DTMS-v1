import { installInitialEnvironment } from './initialEnvironment.ts';

export type PrerenderBootstrap = {
    prerendered: boolean;
    clientIslandIds: string[];
    initialEnvironment?: unknown;
};

type BootstrapElement = {
    getAttribute(name: string): string | null;
    removeAttribute(name: string): void;
};

type BootstrapDocument = {
    getElementById(id: string): BootstrapElement | null;
};

export const MAX_CLIENT_ISLAND_IDS = 100_000;
export const MAX_CLIENT_ISLAND_ID_LENGTH = 256;

/**
 * Consumes the non-executable pre-render metadata attached to the Vue mount point.
 * Keeping this protocol in the DOM avoids requiring `unsafe-inline` in CSP while
 * still making hydration mode available before the application is created. The
 * attributes are removed immediately so large island manifests are not retained
 * by the live DOM for the lifetime of the page.
 */
export function consumePrerenderBootstrap(document: BootstrapDocument | undefined): PrerenderBootstrap {
    const mountPoint = typeof document?.getElementById === 'function' ? document.getElementById('app') : null;
    if (mountPoint?.getAttribute('data-ww-prerendered') !== 'true') {
        return { prerendered: false, clientIslandIds: [] };
    }

    const bootstrap = {
        prerendered: true,
        clientIslandIds: parseClientIslandIds(mountPoint.getAttribute('data-ww-client-islands')),
        initialEnvironment: parseInitialEnvironment(mountPoint.getAttribute('data-ww-initial-environment')),
    };
    mountPoint.removeAttribute('data-ww-prerendered');
    mountPoint.removeAttribute('data-ww-client-islands');
    mountPoint.removeAttribute('data-ww-initial-environment');

    return bootstrap;
}

function parseInitialEnvironment(serializedEnvironment: string | null): unknown {
    if (!serializedEnvironment) return;

    try {
        return JSON.parse(serializedEnvironment);
    } catch {
        return;
    }
}

function parseClientIslandIds(serializedIds: string | null): string[] {
    if (!serializedIds) return [];

    try {
        const ids: unknown = JSON.parse(serializedIds);
        if (!Array.isArray(ids)) return [];

        if (
            ids.length > MAX_CLIENT_ISLAND_IDS ||
            !ids.every(
                (id): id is string =>
                    typeof id === 'string' && id.length > 0 && id.length <= MAX_CLIENT_ISLAND_ID_LENGTH
            )
        ) {
            return [];
        }

        return ids;
    } catch {
        return [];
    }
}

const browserDocument = (globalThis as typeof globalThis & { document?: BootstrapDocument }).document;
const browserBootstrap = consumePrerenderBootstrap(browserDocument);
let restoreEnvironment = browserBootstrap.prerendered
    ? installInitialEnvironment(browserBootstrap.initialEnvironment)
    : () => {};
let pendingClientIslandIds = browserBootstrap.clientIslandIds;

export const isPrerenderedDocument = browserBootstrap.prerendered;

export function consumePrerenderClientIslandIds(): string[] {
    const clientIslandIds = pendingClientIslandIds;
    pendingClientIslandIds = [];
    return clientIslandIds;
}

export function restoreInitialEnvironment(): void {
    restoreEnvironment();
    restoreEnvironment = () => {};
}
