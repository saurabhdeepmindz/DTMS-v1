import { describe, expect, it } from 'vitest';
import {
    enrichRouteHtml,
    getPrerenderCandidates,
    getRouteCssFiles,
    MAX_CLIENT_ISLAND_ID_LENGTH as SERVER_MAX_CLIENT_ISLAND_ID_LENGTH,
    MAX_CLIENT_ISLAND_IDS as SERVER_MAX_CLIENT_ISLAND_IDS,
    reconcileClientIslandAttempt,
} from '../../../wwFront/prerender/core.ts';
import type { ClientBuildManifest, PrerenderRoute } from '../../../wwFront/prerender/core.ts';
import {
    MAX_CLIENT_ISLAND_ID_LENGTH as BROWSER_MAX_CLIENT_ISLAND_ID_LENGTH,
    MAX_CLIENT_ISLAND_IDS as BROWSER_MAX_CLIENT_ISLAND_IDS,
} from './prerenderBootstrap';

describe('pre-rendering build contract', () => {
    it('keeps browser and renderer client-island protocol limits aligned', () => {
        expect(SERVER_MAX_CLIENT_ISLAND_IDS).toBe(BROWSER_MAX_CLIENT_ISLAND_IDS);
        expect(SERVER_MAX_CLIENT_ISLAND_ID_LENGTH).toBe(BROWSER_MAX_CLIENT_ISLAND_ID_LENGTH);
    });

    it('selects only preferred eligible routes', () => {
        const createRoute = (pageId: string, preferred: boolean, eligible: boolean): PrerenderRoute => ({
            pageId,
            url: `/${pageId}`,
            lang: 'en',
            htmlFile: `${pageId}/index.html`,
            preferred,
            eligible,
        });
        const publicRoute = createRoute('public', true, true);

        expect(
            getPrerenderCandidates({
                version: 1,
                routes: [publicRoute, createRoute('disabled', false, true), createRoute('private', true, false)],
            })
        ).toEqual([publicRoute]);
    });

    it('enriches only the app mount point and preserves custom scripts', () => {
        const baseline =
            '<html><head><meta name="ww-build-asset-prefix" content="%2Fsite%2F" /><script id="custom-head"></script><link rel="stylesheet" href="/site/assets/main.css" /></head><body><div id="app" data-ww-app-mount="true"></div><script id="custom-body"></script></body></html>';

        const enriched = enrichRouteHtml(baseline, {
            appHtml: '<main>Static</main>',
            cssFiles: ['assets/section.css', 'assets/page.css'],
            clientIslandIds: ['element:browser-only'],
            initialEnvironment: {
                version: 1,
                randomSeed: 42,
                timestamp: 1_725_000_000_000,
                performanceNow: 12.5,
                viewport: { innerWidth: 1024, innerHeight: 768, devicePixelRatio: 1 },
            },
        });

        expect(enriched).toContain('<link rel="stylesheet" href="/site/assets/section.css" />');
        expect(enriched).toContain('<link rel="stylesheet" href="/site/assets/page.css" />');
        expect(enriched).toContain(
            '<div id="app" data-ww-prerendered="true" data-ww-client-islands="[&quot;element:browser-only&quot;]" data-ww-initial-environment="{&quot;version&quot;:1,&quot;randomSeed&quot;:42,&quot;timestamp&quot;:1725000000000,&quot;performanceNow&quot;:12.5,&quot;viewport&quot;:{&quot;innerWidth&quot;:1024,&quot;innerHeight&quot;:768,&quot;devicePixelRatio&quot;:1}}"><main>Static</main></div>'
        );
        expect(enriched).toContain('<script id="custom-head"></script>');
        expect(enriched).toContain('<script id="custom-body"></script>');
        expect(enriched).not.toContain('window.__WW_PRERENDERED__');
        expect(enriched).not.toContain('window.__WW_CLIENT_ISLANDS__');
    });

    it('ignores mount and asset-like text from custom head content', () => {
        const customHead =
            '<script>window.example = `<div id="app"></div>`</script><script src="https://third.example/assets/sdk.js"></script>';
        const baseline =
            `<html><head><meta name="ww-build-asset-prefix" content="%2Fsite%2F" />${customHead}</head>` +
            '<body><div id="app" data-ww-app-mount="true"></div></body></html>';

        const enriched = enrichRouteHtml(baseline, {
            appHtml: '<main>Static</main>',
            cssFiles: ['assets/page.css'],
        });

        expect(enriched).toContain(customHead);
        expect(enriched).toContain('<link rel="stylesheet" href="/site/assets/page.css" />');
        expect(enriched).not.toContain('https://third.example/assets/page.css');
        expect(enriched).toContain(
            '<div id="app" data-ww-prerendered="true" data-ww-client-islands="[]" data-ww-initial-environment="null"><main>Static</main></div>'
        );
    });

    it('collects route CSS from the page chunk and its static imports', () => {
        const manifest: ClientBuildManifest = {
            'src/pages/home.js': {
                file: 'assets/home.js',
                src: 'src/pages/home.js',
                imports: ['_section.js', '_shared.js'],
                css: ['assets/home.css'],
            },
            '_section.js': {
                file: 'assets/section.js',
                imports: ['_shared.js'],
                css: ['assets/section.css'],
            },
            '_shared.js': {
                file: 'assets/shared.js',
                css: ['assets/shared.css'],
            },
        };

        expect(getRouteCssFiles(manifest, 'home_en')).toEqual([
            'assets/shared.css',
            'assets/section.css',
            'assets/home.css',
        ]);
    });

    it('retries a route when an SSR error discovers a new client island', () => {
        expect(
            reconcileClientIslandAttempt(['element:known'], {
                clientIslandIds: ['element:broken', 'element:known'],
                discoveredClientIslandIds: ['element:broken'],
            })
        ).toEqual({
            clientIslandIds: ['element:broken', 'element:known'],
            shouldRetry: true,
            limitExceeded: false,
        });
    });

    it('accepts an explicit opt-out rendered as an island without another pass', () => {
        expect(
            reconcileClientIslandAttempt([], {
                clientIslandIds: ['element:opt-out'],
                discoveredClientIslandIds: [],
            })
        ).toEqual({
            clientIslandIds: ['element:opt-out'],
            shouldRetry: false,
            limitExceeded: false,
        });
    });

    it('fails the route when client islands exceed the shared protocol limit', () => {
        const clientIslandIds = Array.from(
            { length: SERVER_MAX_CLIENT_ISLAND_IDS + 1 },
            (_, index) => `element:${index}`
        );

        expect(reconcileClientIslandAttempt([], { clientIslandIds })).toEqual({
            clientIslandIds: [],
            shouldRetry: false,
            limitExceeded: true,
        });
    });
});
