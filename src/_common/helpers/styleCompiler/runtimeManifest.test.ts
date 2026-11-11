import { describe, expect, it } from 'vitest';

import type { StyleAtomicClassAssignment, StyleDynamicVariable } from './types';
import { createElementSelector } from './selectors';
import {
    decodeStyleRuntimeManifest,
    decodeStyleRuntimeManifestData,
    encodeStyleRuntimeManifest,
} from './runtimeManifest';

describe('style runtime manifest', () => {
    it('keeps the cross-repository wire format stable', () => {
        const variable = createVariable(0);

        expect(encodeStyleRuntimeManifest([variable])).toEqual([
            1,
            [
                [
                    '--ww-style-element-0-property-0',
                    'element-0',
                    'element:element-0',
                    0,
                    '.ww-e-sZWxlbWVudC0w',
                    2,
                    0,
                    'property-0',
                    'default',
                    0,
                    { __wwtype: 'f', code: 'variables.value0' },
                    'property-0',
                    '.ww-e-sZWxlbWVudC0w',
                    0,
                    '.ww-e-sZWxlbWVudC0w',
                ],
            ],
        ]);
    });

    it('round-trips every runtime field through the compact tuple format', () => {
        const variables: StyleDynamicVariable[] = [
            {
                name: '--ww-style-card-width',
                surface: {
                    key: 'element-layout:card',
                    kind: 'element-layout',
                    selector: '.ww-e-sY2FyZA [data-ww-ls~="sY2FyZA"]',
                    runtimeScopeSelector: '.ww-e-sY2FyZA',
                    group: 'library',
                    libraryLayer: 'instance',
                },
                group: 'element',
                sourceUid: 'card',
                domain: 'style',
                property: 'width',
                state: '_wwHover_default',
                breakpoint: 'tablet',
                value: { __wwtype: 'f', code: 'variables.width' },
                cssProperty: 'width',
                selector: '.ww-e-sY2FyZA:hover [data-ww-ls~="sY2FyZA"]',
                outputKey: 'width',
                valueNormalizer: { type: 'component-size', fallbackValue: 'auto' },
                validationProperty: 'width',
                omitWhenUndefined: true,
                directDeclaration: true,
                condition: [{ value: { __wwtype: 'f', code: 'variables.visible' }, truthy: true }],
                runtimeFallback: {
                    type: 'when-empty',
                    value: { __wwtype: 'f', code: 'variables.span' },
                    valueNormalizer: { type: 'prefix-if-truthy', prefix: 'span ' },
                },
            },
            {
                name: '--ww-style-card-top',
                surface: {
                    key: 'element:card',
                    kind: 'element',
                    selector: '.ww-e-sY2FyZA',
                    group: 'element',
                },
                group: 'element',
                sourceUid: 'card',
                domain: 'style',
                property: 'top',
                state: 'default',
                breakpoint: 'default',
                value: { __wwtype: 'f', code: 'variables.top' },
                cssProperty: 'top',
                selector: '.ww-e-sY2FyZA',
                runtimeFallback: {
                    type: 'when-all-empty',
                    dependencies: [{ __wwtype: 'f', code: 'variables.right' }],
                    value: 0,
                },
            },
            {
                name: '--ww-style-card-animation',
                surface: {
                    key: 'element:card',
                    kind: 'element',
                    selector: '.ww-e-sY2FyZA',
                    group: 'element',
                },
                group: 'element',
                sourceUid: 'card',
                domain: 'content',
                property: 'animation',
                state: 'default',
                breakpoint: 'mobile',
                value: { __wwtype: 'f', code: 'variables.animation' },
                cssProperty: 'animation-name',
                selector: '.ww-e-sY2FyZA',
                kind: 'keyframes',
                keyframesName: 'ww-keyframes-card',
            },
        ];

        const manifest = encodeStyleRuntimeManifest(variables);
        expect(manifest[1][1][21]).toEqual({
            values: [variables[1].value, { __wwtype: 'f', code: 'variables.right' }],
            value: 0,
        });
        expect(decodeStyleRuntimeManifest(JSON.parse(JSON.stringify(manifest)))).toEqual(variables);
    });

    it('groups atomic class assignments by source and surface in the published manifest', () => {
        const atomicClasses: StyleAtomicClassAssignment[] = [
            { sourceUid: 'element-a', surfaceKind: 'element', className: 'ww-a-width' },
            { sourceUid: 'element-a', surfaceKind: 'element', className: 'ww-a-height' },
            { sourceUid: 'section-a', surfaceKind: 'section-container', className: 'ww-a-section' },
        ];

        const manifest = encodeStyleRuntimeManifest([], atomicClasses);

        expect(manifest).toEqual([
            2,
            [],
            [
                ['element-a', [0, ['ww-a-width', 'ww-a-height']]],
                ['section-a', [2, ['ww-a-section']]],
            ],
        ]);
        expect(decodeStyleRuntimeManifestData(JSON.parse(JSON.stringify(manifest)))).toEqual({
            variables: [],
            atomicClasses,
        });
        expect(decodeStyleRuntimeManifest(manifest)).toEqual([]);
    });

    it.each([undefined, null, false, 0, ''])('preserves an empty when-empty fallback (%s) over JSON', value => {
        const variable: StyleDynamicVariable = {
            ...createVariable(0),
            runtimeFallback: {
                type: 'when-empty',
                value,
                valueNormalizer: { type: 'prefix-if-truthy', prefix: 'span ' },
            },
        };

        const manifest = JSON.parse(JSON.stringify(encodeStyleRuntimeManifest([variable])));

        expect(manifest[1][0][23]).toEqual({
            value: value ?? null,
            valueNormalizer: { type: 'prefix-if-truthy', prefix: 'span ' },
        });
        expect(decodeStyleRuntimeManifest(manifest)?.[0].runtimeFallback).toEqual({
            ...variable.runtimeFallback,
            value: value ?? null,
        });
    });

    it.each([{}, { valueNormalizer: { type: 'prefix-if-truthy', prefix: 'span ' } }])(
        'accepts a legacy when-empty fallback whose undefined value was omitted from JSON (%j)',
        fallback => {
            const manifest = JSON.parse(JSON.stringify(encodeStyleRuntimeManifest([createVariable(0)])));
            while (manifest[1][0].length < 24) manifest[1][0].push(null);
            manifest[1][0][23] = fallback;

            expect(decodeStyleRuntimeManifest(manifest)?.[0].runtimeFallback).toEqual({
                type: 'when-empty',
                value: undefined,
                ...fallback,
            });
        }
    );

    it.each([false, 0, '', [], { unexpected: true }])(
        'rejects malformed when-empty fallback metadata (%j)',
        fallback => {
            const manifest = JSON.parse(JSON.stringify(encodeStyleRuntimeManifest([createVariable(0)])));
            while (manifest[1][0].length < 24) manifest[1][0].push(null);
            manifest[1][0][23] = fallback;

            expect(decodeStyleRuntimeManifest(manifest)).toBeNull();
        }
    );

    it('uses page-local source indexes when the Publisher provides them', () => {
        const atomicClasses: StyleAtomicClassAssignment[] = [
            { sourceUid: 'section-a', surfaceKind: 'section-container', className: 'ww-a-section' },
            { sourceUid: 'element-a', surfaceKind: 'element', className: 'ww-a-element' },
            { sourceUid: 'element-b', surfaceKind: 'element', className: 'ww-a-element' },
        ];

        const manifest = encodeStyleRuntimeManifest(
            [],
            atomicClasses,
            new Map([
                ['section-a', 0],
                ['element-a', 1],
                ['element-b', 2],
            ])
        );

        expect(manifest).toEqual([
            2,
            [],
            [
                [2, 'ww-a-section', [0]],
                [0, 'ww-a-element', [1, 2]],
            ],
        ]);
        expect(decodeStyleRuntimeManifestData(manifest)?.atomicClasses).toEqual([
            { sourceIndex: 0, surfaceKind: 'section-container', className: 'ww-a-section' },
            { sourceIndex: 1, surfaceKind: 'element', className: 'ww-a-element' },
            { sourceIndex: 2, surfaceKind: 'element', className: 'ww-a-element' },
        ]);
    });

    it('is smaller than serializing repeated variable objects directly', () => {
        const variables = Array.from({ length: 24 }, (_, index) => createVariable(index));
        const compactBytes = new TextEncoder().encode(JSON.stringify(encodeStyleRuntimeManifest(variables))).length;
        const objectBytes = new TextEncoder().encode(JSON.stringify(variables)).length;

        expect(compactBytes).toBeLessThan(objectBytes * 0.55);
    });

    it('rejects malformed and unsupported payloads for compatibility fallback', () => {
        expect(decodeStyleRuntimeManifest(undefined)).toBeNull();
        expect(decodeStyleRuntimeManifest([2, []])).toBeNull();
        expect(decodeStyleRuntimeManifest([1, [[99]]])).toBeNull();
        const invalidBreakpoint = JSON.parse(JSON.stringify(encodeStyleRuntimeManifest([createVariable(0)])));
        invalidBreakpoint[1][0][9] = 99;
        expect(decodeStyleRuntimeManifest(invalidBreakpoint)).toBeNull();
        const conflictingFallbacks = JSON.parse(
            JSON.stringify(
                encodeStyleRuntimeManifest([
                    {
                        ...createVariable(0),
                        runtimeFallback: {
                            type: 'when-empty',
                            value: { __wwtype: 'f', code: 'variables.span' },
                        },
                    },
                ])
            )
        );
        conflictingFallbacks[1][0][21] = {
            values: [{ __wwtype: 'f', code: 'variables.right' }],
            value: 0,
        };
        expect(decodeStyleRuntimeManifest(conflictingFallbacks)).toBeNull();
        expect(decodeStyleRuntimeManifest([1, []])).toEqual([]);
    });
});

function createVariable(index: number): StyleDynamicVariable {
    const sourceUid = `element-${Math.floor(index / 6)}`;
    const selector = createElementSelector(sourceUid);

    return {
        name: `--ww-style-${sourceUid}-property-${index % 6}`,
        surface: {
            key: `element:${sourceUid}`,
            kind: 'element',
            selector,
            runtimeScopeSelector: selector,
            group: 'element',
        },
        group: 'element',
        sourceUid,
        domain: 'style',
        property: `property-${index % 6}`,
        state: 'default',
        breakpoint: 'default',
        value: { __wwtype: 'f', code: `variables.value${index}` },
        cssProperty: `property-${index % 6}`,
        selector,
    };
}
