import { withStoreRegistry } from '@/pinia/testRegistry.test-support';
import '@/pinia/domainFixtures.test-support';
// @vitest-environment jsdom

import { createSSRApp, defineComponent, h, inject, provide } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { createPinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    activateStaticRendering,
    deactivateStaticRendering,
    StaticRenderFatalError,
} from '@/_front/rendering/staticRenderingContext';
import { denyStaticRenderNetwork } from '../../../../wwFront/prerender/networkCapabilityError';
import { evaluateGlobalFormula, getValue } from './customCode.js';

const runtime = globalThis as typeof globalThis & {
    __WW_STORE_FRONT_CONNECTIONS__?: Record<string, unknown>;
    wwLib?: unknown;
};
const deniedGlobalFormula = {
    id: 'denied',
    name: 'denied',
    type: 'js',
    code: `
        const error = new Error('Requires read access');
        error.name = 'NotCapable';
        throw error;
    `,
};

describe('getValue during static rendering', () => {
    beforeEach(() => {
        const pinia = createPinia();
        runtime.__WW_STORE_FRONT_CONNECTIONS__ = {};
        runtime.wwLib = withStoreRegistry({
            $pinia: pinia,
            $store: {
                getters: {
                    'data/getCollections': {},
                    'data/getFormulas': { denied: deniedGlobalFormula },
                    'data/getPluginFormulas': {},
                    'manager/getSafeMode': false,
                },
            },
            globalContext: {},
            globalVariables: { customCodeVariables: {} },
            wwPlugins: {},
        });
        activateStaticRendering();
    });

    afterEach(() => {
        deactivateStaticRendering();
        delete runtime.__WW_STORE_FRONT_CONNECTIONS__;
        delete runtime.wwLib;
        document.body.innerHTML = '';
        vi.restoreAllMocks();
    });

    it('evaluates formulas and custom JavaScript with the provided component context', () => {
        const context = { component: { props: { title: 'Predictable pricing', plans: ['Free', 'Essential'] } } };

        expect(getValue({ __wwtype: 'f', code: 'context.component.props.title' }, context)).toBe('Predictable pricing');
        expect(getValue({ __wwtype: 'js', code: 'return context.component.props.plans.length' }, context)).toBe(2);
        expect(
            getValue(
                {
                    __wwtype: 'd',
                    data: [
                        { __wwtype: 'f', code: 'context.component.props.plans[0]' },
                        { __wwtype: 'f', code: 'context.component.props.plans[1]' },
                    ],
                },
                context
            )
        ).toEqual(['Free', 'Essential']);
    });

    it('keeps an explicit static projection ahead of formula evaluation', () => {
        expect(
            getValue(
                {
                    __wwtype: 'f',
                    code: 'context.component.props.title',
                    staticValue: 'Projected title',
                },
                { component: { props: { title: 'Runtime title' } } }
            )
        ).toBe('Projected title');
    });

    it('renders and hydrates distinct library component props without a mismatch', async () => {
        const BoundContent = defineComponent({
            name: 'BoundContent',
            setup() {
                const context = inject<Record<string, unknown>>('_wwLibraryComponentContext');
                return () =>
                    h('article', [
                        h('h2', getValue({ __wwtype: 'f', code: 'context.component.props.title' }, context)),
                        h('img', {
                            alt: getValue({ __wwtype: 'f', code: 'context.component.props.title' }, context),
                            src: getValue({ __wwtype: 'f', code: 'context.component.props.logo' }, context),
                        }),
                    ]);
            },
        });
        const LibraryComponent = defineComponent({
            name: 'LibraryComponent',
            props: {
                logo: { type: String, required: true },
                title: { type: String, required: true },
            },
            setup(props) {
                provide('_wwLibraryComponentContext', { component: { props } });
                return () => h(BoundContent);
            },
        });
        const PricingPage = defineComponent({
            name: 'PricingPage',
            setup: () => () =>
                h('main', [
                    h(LibraryComponent, { logo: '/free.svg', title: 'Free' }),
                    h(LibraryComponent, { logo: '/essential.svg', title: 'Essential' }),
                ]),
        });
        const serverHtml = await renderToString(createSSRApp(PricingPage));

        expect(serverHtml).toContain('<h2>Free</h2>');
        expect(serverHtml).toContain('<h2>Essential</h2>');
        expect(serverHtml).toContain('src="/free.svg"');
        expect(serverHtml).toContain('src="/essential.svg"');
        expect(serverHtml).not.toContain('>null<');
        expect(serverHtml).not.toContain('src=""');

        const mountPoint = document.createElement('div');
        mountPoint.innerHTML = serverHtml;
        document.body.append(mountPoint);
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        const hydrationApp = createSSRApp(PricingPage);

        hydrationApp.mount(mountPoint);

        expect(consoleError.mock.calls.flat().join(' ')).not.toMatch(/hydrat|mismatch/i);
        expect(mountPoint.innerHTML).toBe(serverHtml);
        hydrationApp.unmount();
    });

    it('turns a denied static-render capability into a fatal route error', () => {
        expect(() =>
            getValue(
                {
                    __wwtype: 'js',
                    code: `
                        const error = new Error('Requires read access');
                        error.name = 'NotCapable';
                        throw error;
                    `,
                },
                {}
            )
        ).toThrow(StaticRenderFatalError);
    });

    it('turns a blocked network call into a fatal route error', () => {
        const originalFetch = globalThis.fetch;
        globalThis.fetch = () => denyStaticRenderNetwork('fetch');

        try {
            expect(() =>
                getValue(
                    {
                        __wwtype: 'js',
                        code: "return fetch('https://example.test')",
                    },
                    {}
                )
            ).toThrow(StaticRenderFatalError);
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    it('preserves fatal route errors through nested global formula evaluation', () => {
        expect(() => getValue({ __wwtype: 'f', code: 'formulas.denied()' }, {})).toThrow(StaticRenderFatalError);
    });

    it('preserves fatal route errors through the global formula evaluator', () => {
        expect(() => evaluateGlobalFormula(deniedGlobalFormula, {}, [])).toThrow(StaticRenderFatalError);
    });
});
