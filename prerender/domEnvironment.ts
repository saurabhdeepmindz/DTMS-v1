import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { denyStaticRenderNetwork } from './networkCapabilityError.ts';
import { installNodeNetworkGuard } from './nodeNetworkGuard.ts';

type NetworklessDomOptions = {
    publicPath?: string;
    publicUrlPrefix?: string;
};

export function createNetworklessDom(
    html: string,
    url: string,
    { publicPath, publicUrlPrefix }: NetworklessDomOptions = {}
) {
    const dom = new JSDOM(html, {
        url,
        runScripts: 'outside-only',
        resources: undefined,
        pretendToBeVisual: true,
    });
    const restoreNodeNetwork = installNodeNetworkGuard();
    const { window } = dom;

    window.matchMedia = query => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {},
        dispatchEvent() {
            return false;
        },
    });
    window.scrollTo = () => {};
    window.HTMLElement.prototype.scrollIntoView = () => {};

    window.fetch = createStaticAssetFetch(window, publicPath, publicUrlPrefix, denyStaticRenderNetwork);
    window.XMLHttpRequest = class NetworklessXmlHttpRequest {
        open() {
            denyStaticRenderNetwork('XMLHttpRequest');
        }
    } as unknown as typeof window.XMLHttpRequest;
    window.WebSocket = class NetworklessWebSocket {
        constructor() {
            denyStaticRenderNetwork('WebSocket');
        }
    } as unknown as typeof window.WebSocket;

    const globals: Record<string, unknown> = {
        window,
        document: window.document,
        navigator: window.navigator,
        location: window.location,
        history: window.history,
        localStorage: window.localStorage,
        sessionStorage: window.sessionStorage,
        Node: window.Node,
        Element: window.Element,
        HTMLElement: window.HTMLElement,
        SVGElement: window.SVGElement,
        File: window.File,
        FileList: window.FileList,
        Blob: window.Blob,
        FormData: window.FormData,
        DOMParser: window.DOMParser,
        CustomEvent: window.CustomEvent,
        Event: window.Event,
        EventTarget: window.EventTarget,
        MutationObserver: window.MutationObserver,
        getComputedStyle: window.getComputedStyle.bind(window),
        requestAnimationFrame: window.requestAnimationFrame.bind(window),
        cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
        fetch: window.fetch,
        XMLHttpRequest: window.XMLHttpRequest,
        WebSocket: window.WebSocket,
    };

    for (const [name, value] of Object.entries(globals)) {
        Object.defineProperty(globalThis, name, {
            configurable: true,
            writable: true,
            value,
        });
    }

    return {
        dom,
        dispose() {
            window.close();
            for (const name of Object.keys(globals)) {
                delete (globalThis as unknown as Record<string, unknown>)[name];
            }
            restoreNodeNetwork();
        },
    };
}

function createStaticAssetFetch(
    window: JSDOM['window'],
    publicPath: string | undefined,
    publicUrlPrefix: string | undefined,
    blockedNetwork: (api: string) => never
): typeof window.fetch {
    if (!publicPath) return (() => blockedNetwork('fetch')) as typeof window.fetch;

    const resolvedPublicPath = fs.realpathSync(publicPath);

    return ((input: RequestInfo | URL, init?: RequestInit) => {
        const requestUrl = new window.URL(getRequestUrl(input), window.location.href);
        const method = (init?.method || getRequestMethod(input) || 'GET').toUpperCase();
        if (requestUrl.origin !== window.location.origin || (method !== 'GET' && method !== 'HEAD')) {
            return blockedNetwork('fetch');
        }

        const requestedPath = removePublicUrlPrefix(decodeURIComponent(requestUrl.pathname), publicUrlPrefix);
        const readablePath = resolveReadablePublicFile(resolvedPublicPath, requestedPath);
        if (!readablePath) return blockedNetwork('fetch');

        return fsPromises
            .readFile(readablePath)
            .then(content => new Response(method === 'HEAD' ? null : content, { status: 200 })) as ReturnType<
            typeof window.fetch
        >;
    }) as typeof window.fetch;
}

function removePublicUrlPrefix(requestedPath: string, publicUrlPrefix: string | undefined): string {
    const normalizedPrefix = normalizePublicUrlPrefix(publicUrlPrefix);
    if (normalizedPrefix === '/') return requestedPath;

    const prefixWithoutTrailingSlash = normalizedPrefix.slice(0, -1);
    if (requestedPath === prefixWithoutTrailingSlash) return '/';
    if (requestedPath.startsWith(normalizedPrefix)) return `/${requestedPath.slice(normalizedPrefix.length)}`;
    return requestedPath;
}

function normalizePublicUrlPrefix(publicUrlPrefix: string | undefined): string {
    if (!publicUrlPrefix) return '/';

    try {
        const pathname = decodeURIComponent(new URL(publicUrlPrefix, 'http://weweb.local').pathname);
        return pathname.endsWith('/') ? pathname : `${pathname}/`;
    } catch {
        return '/';
    }
}

function resolveReadablePublicFile(publicPath: string, requestedPath: string): string | null {
    const resolvedPath = path.resolve(publicPath, `.${requestedPath}`);
    let readablePath: string;
    try {
        readablePath = fs.realpathSync(resolvedPath);
    } catch {
        return null;
    }

    if (!isInsideDirectory(publicPath, readablePath) || !fs.statSync(readablePath).isFile()) return null;
    return readablePath;
}

function getRequestUrl(input: RequestInfo | URL): string {
    return typeof input === 'string' || input instanceof URL ? `${input}` : input.url;
}

function getRequestMethod(input: RequestInfo | URL): string | undefined {
    return typeof input === 'object' && input !== null && 'method' in input ? input.method : undefined;
}

function isInsideDirectory(directory: string, candidate: string): boolean {
    const relativePath = path.relative(directory, candidate);
    return relativePath !== '..' && !relativePath.startsWith(`..${path.sep}`) && !path.isAbsolute(relativePath);
}
