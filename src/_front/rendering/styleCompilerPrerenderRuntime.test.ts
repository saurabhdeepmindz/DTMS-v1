import { withStoreRegistry } from '@/pinia/testRegistry.test-support';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { StyleDynamicVariable } from '@/_common/helpers/styleCompiler';
import { setStyleCompilerRuntimeVariable } from '@/_front/services/styleCompilerRuntimeStyleSheet';
import {
    cancelStyleCompilerPrerenderRuntime,
    completeStyleCompilerPrerenderRuntime,
    isStyleCompilerPrerenderRuntimeActive,
    prepareStyleCompilerPrerenderRuntime,
    removeStyleCompilerPrerenderRuntime,
} from './styleCompilerPrerenderRuntime';

afterEach(() => {
    cancelStyleCompilerPrerenderRuntime();
    vi.unstubAllGlobals();
});

describe('style compiler prerender runtime', () => {
    it('removes every server runtime style only when takeover is released', () => {
        const first = { remove: vi.fn() };
        const second = { remove: vi.fn() };
        const querySelectorAll = vi.fn(() => [first, second]);

        removeStyleCompilerPrerenderRuntime({ querySelectorAll } as unknown as Document);

        expect(querySelectorAll).toHaveBeenCalledWith('style[data-ww-style-compiler-prerendered]');
        expect(first.remove).toHaveBeenCalledOnce();
        expect(second.remove).toHaveBeenCalledOnce();
    });

    it('serializes the runtime CSSOM after server-rendered scopes finish', () => {
        const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>');
        vi.stubGlobal('wwLib', withStoreRegistry({
            getFrontDocument: () => dom.window.document,
            wwLog: { warn: vi.fn() },
        }));
        prepareStyleCompilerPrerenderRuntime();

        setStyleCompilerRuntimeVariable({
            componentId: '44',
            variable: createDisplayVariable(),
            cssValue: 'flex',
        });
        const css = completeStyleCompilerPrerenderRuntime();

        expect(css).toContain('@layer ww-style-runtime');
        expect(css).toContain('[data-ww-component-id="44"]');
        expect(css).toContain('--ww-style-display: flex');
        expect(isStyleCompilerPrerenderRuntimeActive()).toBe(false);
        dom.window.close();
    });
});

function createDisplayVariable(): StyleDynamicVariable {
    return {
        name: '--ww-style-display',
        surface: {
            key: 'element:menu',
            group: 'element',
            kind: 'element',
            selector: '.ww-element-menu',
        },
        group: 'element',
        sourceUid: 'menu',
        domain: 'style',
        property: 'display',
        state: 'base',
        breakpoint: 'default',
        value: { __wwtype: 'f', code: 'context.component.props.visible' },
        cssProperty: 'display',
        validationProperty: 'display',
        selector: '.ww-element-menu',
    };
}
