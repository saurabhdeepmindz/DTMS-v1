import { withStoreRegistry } from '@/pinia/testRegistry.test-support';
import '@/pinia/domainFixtures.test-support';
import { createPinia } from 'pinia';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    activateStaticRendering,
    deactivateStaticRendering,
    StaticRenderFatalError,
} from '@/_front/rendering/staticRenderingContext';
import { prerenderStyleFormulaExecutor, styleFormulaExecutor } from './styleFormulaExecutor';

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

afterEach(() => {
    deactivateStaticRendering();
    vi.unstubAllGlobals();
});

describe('styleFormulaExecutor', () => {
    it('evaluates prerendered runtime styles against each live component context', () => {
        installWwLib();
        activateStaticRendering();
        const formula = {
            __wwtype: 'f',
            code: 'context.component.props.visible',
            staticValue: false,
        };

        expect(styleFormulaExecutor.execute(formula, { component: { props: { visible: true } } })).toEqual({
            status: 'resolved',
            value: false,
        });
        expect(prerenderStyleFormulaExecutor.execute(formula, { component: { props: { visible: true } } })).toEqual({
            status: 'resolved',
            value: true,
        });
        expect(prerenderStyleFormulaExecutor.execute(formula, { component: { props: { visible: false } } })).toEqual({
            status: 'resolved',
            value: false,
        });
    });

    it.each([
        ['formula', { __wwtype: 'f', code: 'context.missing.value', staticValue: 'grid' }],
        ['custom JavaScript', { __wwtype: 'js', code: 'return context.missing.value' }],
    ])('keeps the static CSS fallback when prerendered %s throws', (_label, formula) => {
        installWwLib();
        activateStaticRendering();

        expect(prerenderStyleFormulaExecutor.execute(formula, {})).toMatchObject({
            status: 'error',
        });
    });

    it('keeps the static CSS fallback when a prerendered style reads the unavailable DOM instance', () => {
        installWwLib();
        activateStaticRendering();
        const formula = {
            __wwtype: 'f',
            code: 'context.thisInstance?.offsetWidth',
            staticValue: '320px',
        };

        expect(prerenderStyleFormulaExecutor.execute(formula, { thisInstance: undefined })).toMatchObject({
            status: 'error',
        });
    });

    it('keeps intentional undefined prerendered style results distinct from unavailable DOM context', () => {
        installWwLib();
        activateStaticRendering();
        const formula = {
            __wwtype: 'f',
            code: 'undefined',
            staticValue: 'block',
        };

        expect(prerenderStyleFormulaExecutor.execute(formula, {})).toEqual({
            status: 'resolved',
            value: undefined,
        });
    });

    it('does not change the browser runtime error semantics', () => {
        installWwLib();

        expect(styleFormulaExecutor.execute({ __wwtype: 'f', code: 'context.missing.value' }, {})).toEqual({
            status: 'resolved',
            value: undefined,
        });
    });

    it('lets fatal static-render permission errors abort the route', () => {
        installWwLib();
        activateStaticRendering();

        expect(() =>
            prerenderStyleFormulaExecutor.execute(
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

    it('lets nested global formula permission errors abort the route', () => {
        installWwLib();
        activateStaticRendering();

        expect(() => prerenderStyleFormulaExecutor.execute({ __wwtype: 'f', code: 'formulas.denied()' }, {})).toThrow(
            StaticRenderFatalError
        );
    });
});

function installWwLib() {
    const pinia = createPinia();
    vi.stubGlobal('__WW_STORE_FRONT_CONNECTIONS__', {});
    vi.stubGlobal('wwLib', withStoreRegistry({
        $pinia: pinia,
        $store: {
            getters: {
                'data/getCollections': {},
                'data/getFormulas': { denied: deniedGlobalFormula },
                'data/getPluginFormulas': {},
            },
        },
        wwPlugins: {},
        globalVariables: { customCodeVariables: {} },
        globalContext: {},
    }));
}
