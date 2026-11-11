import { describe, expect, it } from 'vitest';
import { isServerRenderMode, isStaticRenderMode, resolveRenderMode } from './renderMode';

describe('render mode', () => {
    it.each([
        [{ serverRendering: false, prerendered: false }, 'runtime'],
        [{ serverRendering: true, prerendered: false }, 'ssr'],
        [{ serverRendering: false, prerendered: true }, 'hydrate'],
    ] as const)('resolves %o as %s', (input, expected) => {
        expect(resolveRenderMode(input)).toBe(expected);
    });

    it('derives the execution policies from the mode', () => {
        expect(isStaticRenderMode('runtime')).toBe(false);
        expect(isStaticRenderMode('hydrate')).toBe(true);
        expect(isServerRenderMode('ssr')).toBe(true);
    });
});
