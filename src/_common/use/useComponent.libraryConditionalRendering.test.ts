import { readFileSync } from 'node:fs';

import { computed, reactive, ref } from 'vue';
import { describe, expect, it, vi } from 'vitest';

import {
    createLibraryComponentLayoutData,
    createLibraryComponentRenderingData,
    resolveLibraryComponentLayoutValue,
    resolveLibraryComponentConditionalRendering,
    resolveLibraryComponentRawLayoutValue,
} from '@/_common/helpers/component/libraryComponentRendering';

describe('library component conditional rendering', () => {
    it('forwards reactive instance conditions so they override a hidden library root', () => {
        const condition = ref(true);
        const libraryComponentData = reactive({
            ...createLibraryComponentRenderingData({
                raw: computed(() => ({ __wwtype: 'f' })),
                value: computed(() => condition.value),
            }),
        });
        const fallback = vi.fn(() => false);
        const resolveRootCondition = () => resolveLibraryComponentConditionalRendering(libraryComponentData, fallback);

        expect(resolveRootCondition()).toBe(true);
        expect(fallback).not.toHaveBeenCalled();

        condition.value = false;

        expect(resolveRootCondition()).toBe(false);
        expect(fallback).not.toHaveBeenCalled();
        expect(libraryComponentData).not.toHaveProperty('style');
        expect(libraryComponentData).not.toHaveProperty('rawStyle');
    });

    it('uses the root condition when the rendering override is incomplete', () => {
        const fallback = vi.fn(() => false);

        expect(
            resolveLibraryComponentConditionalRendering(
                { rendering: { conditionalRendering: { value: true } } },
                fallback
            )
        ).toBe(false);
        expect(fallback).toHaveBeenCalledOnce();
    });

    it('keeps the library root mounted so it can run its conditional-rendering lifecycle', () => {
        const source = readFileSync(new URL('../../_front/components/wwLibraryComponent.vue', import.meta.url), 'utf8');

        expect(source).toContain('<ComponentLoader v-else :key="rootUid"');
        expect(source).toContain('v-if="!isLoop"');
        expect(source).not.toContain('v-else-if="isRendering"');
        expect(source).not.toContain('v-if="!isLoop && isRendering"');
    });
});

describe('library component layout runtime data', () => {
    it('forwards reactive instance layout values to the concrete root', () => {
        const display = ref('block');
        const textAlign = ref('center');
        const libraryComponentData = reactive({
            ...createLibraryComponentLayoutData({
                display: {
                    raw: () => ({ __wwtype: 'f', code: 'display' }),
                    value: () => display.value,
                },
                textAlign: {
                    raw: () => ({ __wwtype: 'f', code: 'textAlign' }),
                    value: () => textAlign.value,
                },
            }),
        });
        const fallback = vi.fn(() => 'fallback');

        expect(resolveLibraryComponentLayoutValue(libraryComponentData, 'display', fallback)).toBe('block');
        expect(resolveLibraryComponentLayoutValue(libraryComponentData, 'textAlign', fallback)).toBe('center');

        display.value = 'flex';
        textAlign.value = 'right';

        expect(resolveLibraryComponentLayoutValue(libraryComponentData, 'display', fallback)).toBe('flex');
        expect(resolveLibraryComponentLayoutValue(libraryComponentData, 'textAlign', fallback)).toBe('right');
        expect(fallback).not.toHaveBeenCalled();
        expect(libraryComponentData).not.toHaveProperty('style');
        expect(libraryComponentData).not.toHaveProperty('rawStyle');
    });

    it('uses the concrete root value when an instance override is incomplete', () => {
        const fallback = vi.fn(() => 'grid');

        expect(
            resolveLibraryComponentLayoutValue({ layout: { display: { value: () => 'block' } } }, 'display', fallback)
        ).toBe('grid');
        expect(fallback).toHaveBeenCalledOnce();
    });

    it('forwards the raw override marker through nested library roots', () => {
        const rawDisplay = { __wwtype: 'f', code: 'outerDisplay' };
        const libraryComponentData = reactive({
            ...createLibraryComponentLayoutData({
                display: {
                    raw: () => rawDisplay,
                    value: () => 'block',
                },
                textAlign: {
                    raw: () => undefined,
                    value: () => undefined,
                },
            }),
        });
        const fallback = vi.fn(() => 'fallback');

        expect(resolveLibraryComponentRawLayoutValue(libraryComponentData, 'display', fallback)).toBe(rawDisplay);
        expect(fallback).not.toHaveBeenCalled();
    });
});
