import { effectScope, nextTick, watchEffect } from 'vue';
import { describe, expect, it } from 'vitest';

import {
    getStyleAtomicClassesForSource,
    registerStyleAtomicClass,
    registerStyleAtomicClasses,
} from './styleCompilerAtomicClasses';

describe('style compiler atomic classes', () => {
    it('keeps a class registered until its final compiler owner is disposed', () => {
        const assignment = {
            sourceUid: 'element-a',
            surfaceKind: 'element' as const,
            className: 'ww-a-display',
        };
        const stopFirst = registerStyleAtomicClass(assignment);
        const stopSecond = registerStyleAtomicClass(assignment);

        expect(getStyleAtomicClassesForSource('element-a', 'element')).toEqual(['ww-a-display']);

        stopFirst();
        expect(getStyleAtomicClassesForSource('element-a', 'element')).toEqual(['ww-a-display']);

        stopSecond();
        expect(getStyleAtomicClassesForSource('element-a', 'element')).toEqual([]);
    });

    it('registers a published manifest under one cleanup', () => {
        const stop = registerStyleAtomicClasses([
            { sourceUid: 'section-a', surfaceKind: 'section-container', className: 'ww-a-container' },
            { sourceUid: 'section-a', surfaceKind: 'section-element', className: 'ww-a-element' },
        ]);

        expect(getStyleAtomicClassesForSource('section-a', 'section-container')).toEqual(['ww-a-container']);
        expect(getStyleAtomicClassesForSource('section-a', 'section-element')).toEqual(['ww-a-element']);

        stop();
        expect(getStyleAtomicClassesForSource('section-a', 'section-container')).toEqual([]);
        expect(getStyleAtomicClassesForSource('section-a', 'section-element')).toEqual([]);
    });

    it('keeps every published class assigned to the same source surface', () => {
        const stop = registerStyleAtomicClasses([
            { sourceUid: 'element-a', surfaceKind: 'element', className: 'ww-a-width' },
            { sourceUid: 'element-a', surfaceKind: 'element', className: 'ww-a-height' },
            { sourceUid: 'element-a', surfaceKind: 'element', className: 'ww-a-width' },
        ]);

        expect(getStyleAtomicClassesForSource('element-a', 'element')).toEqual([
            'ww-a-width',
            'ww-a-height',
        ]);

        stop();
        expect(getStyleAtomicClassesForSource('element-a', 'element')).toEqual([]);
    });

    it('reference-counts duplicate and overlapping published manifests', () => {
        const assignment = {
            sourceUid: 'element-b',
            surfaceKind: 'element' as const,
            className: 'ww-a-shared',
        };
        const stopFirst = registerStyleAtomicClasses([assignment, assignment]);
        const stopSecond = registerStyleAtomicClasses([assignment]);

        stopFirst();
        expect(getStyleAtomicClassesForSource('element-b', 'element')).toEqual(['ww-a-shared']);

        stopSecond();
        expect(getStyleAtomicClassesForSource('element-b', 'element')).toEqual([]);
    });

    it('invalidates only components reading the changed source bucket', async () => {
        const scope = effectScope();
        let reads = 0;
        scope.run(() => {
            watchEffect(() => {
                reads++;
                getStyleAtomicClassesForSource('element-a', 'element');
            });
        });

        const stopOther = registerStyleAtomicClass({
            sourceUid: 'element-b',
            surfaceKind: 'element',
            className: 'ww-a-other',
        });
        await nextTick();
        expect(reads).toBe(1);

        const stopTarget = registerStyleAtomicClass({
            sourceUid: 'element-a',
            surfaceKind: 'element',
            className: 'ww-a-target',
        });
        await nextTick();
        expect(reads).toBe(2);

        stopTarget();
        stopOther();
        scope.stop();
    });
});
