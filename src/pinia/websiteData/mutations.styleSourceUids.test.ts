import { createStoreRegistry } from '@/pinia/storeRegistry';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/pinia/variables.js', () => ({ useVariablesStore: vi.fn() }));
vi.mock('@/pinia/backTableViews.js', () => ({ useBackTableViewsStore: vi.fn() }));
vi.mock('@/pinia/backTableFormulaColumns.js', () => ({ useBackTableFormulaColumnsStore: vi.fn() }));
vi.mock('@/_manager/helpers/plugins.js', () => ({ PLUGIN_CATEGORIES: {} }));
vi.mock('@/_common/helpers/pathResolver', () => ({ getPath: vi.fn() }));

import { createPinia } from 'pinia';
import { useWebsiteDataStore } from './index';

describe('websiteData page style source order', () => {
    it('captures incoming page order instead of retained store insertion order', () => {
        const pinia = createPinia();
        const store = useWebsiteDataStore(pinia);
        const state = store.$state;
        const mutations = createStoreRegistry(pinia).websiteData.writers;
        state.design.pages = [{ id: 'page-b' }];
        state.wwObjects = {
            'retained-from-page-a': { uid: 'retained-from-page-a' },
        };

        mutations.setPageData({
            page: { id: 'page-b' },
            sections: {
                'section-b': { uid: 'section-b' },
            },
            wwObjects: {
                'element-b-2': { uid: 'element-b-2' },
                'element-b-1': { uid: 'element-b-1' },
            },
        });

        expect(state.styleSourceUids).toEqual(['section-b', 'element-b-2', 'element-b-1']);
        expect(state.sections['section-b']._si).toBe(0);
        expect(state.wwObjects['element-b-2']._si).toBe(1);
        expect(state.wwObjects['element-b-1']._si).toBe(2);
    });

    it('keeps loaded ids and repairs duplicated source ids before storing new elements', () => {
        const pinia = createPinia();
        const store = useWebsiteDataStore(pinia);
        const state = store.$state;
        const mutations = createStoreRegistry(pinia).websiteData.writers;
        const original = { uid: 'original', _si: 12 };
        const duplicate = { uid: 'duplicate', _si: 12 };

        mutations.createMultipleWwObjects([original, duplicate]);

        expect(state.wwObjects.original._si).toBe(12);
        expect(state.wwObjects.duplicate._si).toBe(13);
    });

    it('removes transient preview objects and their style identities', () => {
        const store = useWebsiteDataStore(createPinia());
        const state = store.$state;
        const mutations = store.writers;
        const preview: { uid: string; _si?: number } = { uid: 'drag-preview' };

        mutations.createWwObjectPreview([preview]);
        const styleSourceId = preview._si;
        expect(state.wwObjectPreviewUids).toEqual(['drag-preview']);
        mutations.removeWwObjectPreview(['drag-preview']);

        expect(state.wwObjects['drag-preview']).toBeUndefined();
        expect(state.styleSourceIdRegistry.idByUid.has('drag-preview')).toBe(false);
        expect(state.styleSourceIdRegistry.uidById.has(styleSourceId)).toBe(false);
        expect(state.wwObjectPreviewUids).toEqual([]);
        expect(state.history.undo).toEqual([]);
    });
});
