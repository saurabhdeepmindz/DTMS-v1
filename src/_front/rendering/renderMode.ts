import { isPrerenderedDocument } from './prerenderBootstrap.ts';

/**
 * Controls which parts of the front application may run during rendering.
 *
 * - `runtime`: Normal client-side rendering. All runtime services, integrations,
 *   collections, formulas, and workflows may run immediately.
 * - `ssr`: Server-side static projection used to generate the pre-rendered HTML.
 *   Dynamic bindings use neutral values and browser runtime services stay disabled.
 * - `hydrate`: Browser hydration of pre-rendered HTML. It prepares traditional mount
 *   prerequisites while keeping the `ssr` static projection, then activates the full
 *   runtime after mounting.
 */
export type RenderMode = 'runtime' | 'ssr' | 'hydrate';

type RenderModeInput = {
    serverRendering: boolean;
    prerendered: boolean;
};

export function resolveRenderMode({ serverRendering, prerendered }: RenderModeInput): RenderMode {
    if (serverRendering) return 'ssr';
    if (prerendered) return 'hydrate';
    return 'runtime';
}

export const renderMode = resolveRenderMode({
    serverRendering: import.meta.env.SSR && import.meta.env.MODE !== 'test',
    prerendered: isPrerenderedDocument,
});

export function isStaticRenderMode(mode: RenderMode): boolean {
    return mode !== 'runtime';
}

export function isServerRenderMode(mode: RenderMode): boolean {
    return mode === 'ssr';
}
