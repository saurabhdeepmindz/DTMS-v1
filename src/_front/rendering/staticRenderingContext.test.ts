import { computed } from 'vue';
import { afterEach, describe, expect, it } from 'vitest';
import {
    activateStaticRendering,
    deactivateStaticRendering,
    isStaticRenderingActive,
    resolveStaticBinding,
    withoutStaticBindingProjection,
} from './staticRenderingContext';

describe('Static Rendering Context', () => {
    afterEach(() => {
        deactivateStaticRendering();
    });

    it('keeps persisted literal values unchanged', () => {
        activateStaticRendering();

        expect(resolveStaticBinding('Static heading')).toBeUndefined();
    });

    it('lets formulas without a static projection use the normal evaluator', () => {
        activateStaticRendering();

        expect(resolveStaticBinding({ __wwtype: 'f', code: "collections['articles'].data[0].title" })).toBeUndefined();
    });

    it.each([
        ['false', false],
        ['zero', 0],
        ['empty string', ''],
        ['null', null],
        ['array', ['first', 'second']],
        ['object', { visible: true }],
    ])('uses an explicit %s static formula value', (_label, staticValue) => {
        activateStaticRendering();

        expect(resolveStaticBinding({ __wwtype: 'f', code: 'variables.value', staticValue })).toEqual({
            value: staticValue,
        });
    });

    it('never treats a formula default value as its static projection', () => {
        activateStaticRendering();

        expect(
            resolveStaticBinding({ __wwtype: 'f', code: 'variables.value', defaultValue: 'legacy fallback' })
        ).toBeUndefined();
    });

    it('temporarily bypasses a persisted projection for per-instance evaluation', () => {
        const formula = { __wwtype: 'f', code: 'context.component.props.visible', staticValue: false };
        activateStaticRendering();

        expect(withoutStaticBindingProjection(() => resolveStaticBinding(formula))).toBeUndefined();
        expect(resolveStaticBinding(formula)).toEqual({ value: false });
    });

    it('restores static projection after a bypassed evaluation throws', () => {
        const formula = { __wwtype: 'f', code: 'variables.value', staticValue: 'projected' };
        activateStaticRendering();

        expect(() =>
            withoutStaticBindingProjection(() => {
                throw new Error('formula failed');
            })
        ).toThrow('formula failed');
        expect(resolveStaticBinding(formula)).toEqual({ value: 'projected' });
    });

    it('lets custom JavaScript and dynamic bindings use the normal evaluator', () => {
        activateStaticRendering();

        expect(resolveStaticBinding({ __wwtype: 'js', code: 'return context.component.props.title' })).toBeUndefined();
        expect(resolveStaticBinding({ __wwtype: 'd', data: ['dynamic'] })).toBeUndefined();
    });

    it('releases dynamic bindings during Runtime Activation', () => {
        activateStaticRendering();
        deactivateStaticRendering();

        expect(resolveStaticBinding({ __wwtype: 'f', code: 'variables.value' })).toBeUndefined();
        expect(resolveStaticBinding({ __wwtype: 'f', code: 'variables.value', staticValue: 'static' })).toBeUndefined();
    });

    it('invalidates static computed bindings when Runtime Activation starts', () => {
        activateStaticRendering();
        const resolution = computed(() =>
            resolveStaticBinding({
                __wwtype: 'f',
                code: "collections['articles'].data[0].title",
                staticValue: 'Projected title',
            })
        );

        expect(resolution.value).toEqual({
            value: 'Projected title',
        });

        deactivateStaticRendering();

        expect(resolution.value).toBeUndefined();
    });

    it('keeps the normal runtime context inactive', () => {
        deactivateStaticRendering();
        let trackedDependencies = 0;
        const resolution = computed(() => resolveStaticBinding({ __wwtype: 'f', code: 'variables.value' }), {
            onTrack: () => trackedDependencies++,
        });

        expect(isStaticRenderingActive()).toBe(false);
        expect(resolution.value).toBeUndefined();
        expect(trackedDependencies).toBe(0);
    });
});
