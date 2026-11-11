import { describe, expect, it, vi } from 'vitest';
import { collectPageCollections } from './collectionDependencies';

const defaults = () => ({
    page: {},
    websiteWorkflows: [],
    collections: [] as { id: string; value?: unknown }[],
    workflows: [] as { id: string; value?: unknown }[],
    formulas: [] as { id: string; value?: unknown }[],
    libraryComponents: [] as { id: string; value?: unknown }[],
    getComponentElements: vi.fn(() => [] as unknown[]),
});

describe('page collection dependencies', () => {
    it('follows nested workflows, formulas, component children and collection dependencies, preserving registry order', () => {
        const input = {
            ...defaults(),
            page: { binding: 'workflow-start' },
            websiteWorkflows: [{ binding: 'collection-site' }],
            workflows: [{ id: 'workflow-start', value: 'formula-next' }],
            formulas: [{ id: 'formula-next', value: 'component-card' }],
            libraryComponents: [{ id: 'component-card' }],
            collections: [
                { id: 'collection-second' },
                { id: 'collection-unused' },
                { id: 'collection-first', value: 'collection-second' },
                { id: 'collection-site' },
            ],
            getComponentElements: vi.fn(() => [{ binding: 'collection-first' }]),
        };
        expect(collectPageCollections(input).map(item => item.id)).toEqual([
            'collection-second',
            'collection-first',
            'collection-site',
        ]);
        expect(input.getComponentElements).toHaveBeenCalledExactlyOnceWith('component-card');
    });

    it('terminates cycles and serializes each reachable resource once', () => {
        const serialize = vi.fn(() => ({ id: 'collection-a', dependency: 'collection-b' }));
        const input = {
            ...defaults(),
            page: 'collection-a',
            collections: [
                { id: 'collection-a', toJSON: serialize },
                { id: 'collection-b', value: 'collection-a' },
            ],
        };
        expect(collectPageCollections(input)).toEqual(input.collections);
        expect(serialize).toHaveBeenCalledTimes(1);
    });

    it('recognizes escaped, overlapping and embedded IDs in arbitrary formula strings', () => {
        const collections = ['ab', 'abc', 'bc', 'c+', 'c.'].map(id => ({ id }));
        expect(collectPageCollections({ ...defaults(), page: 'prefix-abc-suffix c+', collections })).toEqual(
            collections.slice(0, 4)
        );
    });

    it('keeps resources with the same ID in different registries and sees subsequent edits', () => {
        const input = {
            ...defaults(),
            page: 'shared',
            workflows: [{ id: 'shared', value: 'collection-a' }],
            formulas: [{ id: 'shared', value: 'collection-b' }],
            collections: [{ id: 'collection-a' }, { id: 'collection-b' }, { id: 'collection-c' }],
        };
        expect(collectPageCollections(input)).toEqual(input.collections.slice(0, 2));
        input.formulas[0].value = 'collection-c';
        expect(collectPageCollections(input)).toEqual([input.collections[0], input.collections[2]]);
    });

    it('does not inspect unused resources or component children', () => {
        const input = {
            ...defaults(),
            collections: [
                {
                    id: 'unused',
                    toJSON: () => {
                        throw new Error('unused data');
                    },
                },
            ],
            libraryComponents: [{ id: 'unused-component' }],
        };
        expect(collectPageCollections(input)).toEqual([]);
        expect(input.getComponentElements).not.toHaveBeenCalled();
    });

    it('handles a deep dependency chain without recursive traversal', () => {
        const collections = Array.from({ length: 1200 }, (_, index) => ({
            id: `collection-${index.toString().padStart(4, '0')}`,
            value: `collection-${((index + 1) % 1200).toString().padStart(4, '0')}`,
        }));
        expect(collectPageCollections({ ...defaults(), page: collections[0].id, collections })).toEqual(collections);
    });
});
