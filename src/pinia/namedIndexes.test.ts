import { createTestCompatibilityStore, withStoreRegistry } from '@/pinia/testRegistry.test-support';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, nextTick, watchEffect } from 'vue';

import wwPluginHelper from '@/wwLib/services/wwPluginHelper';
import wwCollection from '@/wwLib/services/wwCollection';
import wwWebsiteData from '@/wwLib/services/wwWebsiteData';

// Network/editor loading is outside the public reactive read contract exercised here.
vi.mock('@/helpers/loadEditor.js', () => ({ default: vi.fn() }));

function setup() {
    const { store, $pinia: pinia } = withStoreRegistry({ wwPluginHelper, wwCollection, wwWebsiteData });
    return { store, facade: createTestCompatibilityStore(pinia) };
}

beforeEach(() => vi.stubGlobal('localStorage', { setItem: vi.fn() }));

describe('named native indexes and public state properties', () => {
    it('preserves first-match lookup, original references and historical callable getters', () => {
        const { store, facade } = setup();
        store.websiteData.plugins = [
            { id: 'plugin', namespace: 'airtable' },
            { id: 'plugin', namespace: 'duplicate' },
            { id: '__proto__', namespace: 'constructor' },
        ];
        const plugin = store.websiteData.plugins[0];
        expect(store.websiteData.pluginsById.plugin).toBe(plugin);
        expect(store.websiteData.pluginsByComponentId['plugin-plugin']).toBe(plugin);
        expect(store.websiteData.pluginsByNamespace.airtable).toBe(plugin);
        expect(wwPluginHelper.pluginsById.plugin).toBe(plugin);
        expect(wwPluginHelper.getPluginById('plugin')).toBe(plugin);
        expect(facade.getters['websiteData/getPluginById']('plugin')).toBe(plugin);
        expect(facade.getters['websiteData/getPluginById']('missing')).toBeUndefined();
        expect(store.websiteData.pluginsById.__proto__).toBe(store.websiteData.plugins[2]);
        expect(store.websiteData.pluginsById.constructor).toBeUndefined();
    });

    it('tracks insertions, metadata changes, namespace changes and array replacement through both interfaces', async () => {
        const { store, facade } = setup();
        const lookup = facade.getters['websiteData/getPluginById'];
        const reads = vi.fn();
        const scope = effectScope();
        scope.run(() => watchEffect(() => reads(wwPluginHelper.pluginsById.plugin?.name)));
        store.websiteData.plugins.push({ id: 'plugin', namespace: 'old', name: 'First' });
        await nextTick();
        expect(reads).toHaveBeenLastCalledWith('First');
        store.websiteData.plugins[0].name = 'Updated';
        store.websiteData.plugins[0].namespace = 'new';
        await nextTick();
        expect(reads).toHaveBeenLastCalledWith('Updated');
        expect(store.websiteData.pluginsByNamespace.old).toBeUndefined();
        expect(store.websiteData.pluginsByNamespace.new).toBe(lookup('plugin'));
        store.websiteData.plugins = [{ id: 'plugin', namespace: 'replacement', name: 'Replacement' }];
        await nextTick();
        expect(reads).toHaveBeenLastCalledWith('Replacement');
        expect(lookup('plugin')).toBe(store.websiteData.plugins[0]);
        store.websiteData.plugins = [];
        await nextTick();
        expect(reads).toHaveBeenLastCalledWith(undefined);
        expect(lookup('plugin')).toBeUndefined();
        scope.stop();
    });

    it('retains page link alias precedence and stored page identity', () => {
        const { store, facade } = setup();
        store.websiteData.design.pages = [{ id: 'first', linkId: 'collision' }, { id: 'collision' }];
        expect(store.websiteData.pagesById.collision).toBe(store.websiteData.design.pages[1]);
        expect(store.websiteData.pagesByLinkId.collision).toBe(store.websiteData.design.pages[0]);
        expect(facade.getters['websiteData/getPageByLinkId']('collision')).toBe(store.websiteData.design.pages[0]);
        expect(wwWebsiteData.pages).toBe(wwWebsiteData.getPages());
        expect(wwWebsiteData.design).toBe(wwWebsiteData.getDesign());
        expect(wwWebsiteData.info).toBe(wwWebsiteData.getInfo());
    });

    it('keeps project and catalogue indexes isolated and collection properties live across replacement', () => {
        const { store } = setup();
        store.websiteData.plugins = [{ id: 'plugin', namespace: 'installed' }];
        store.manager.plugins = [{ id: 'plugin', namespace: 'catalogue' }];
        expect(store.websiteData.pluginsById.plugin.namespace).toBe('installed');
        expect(store.manager.pluginsById.plugin.namespace).toBe('catalogue');
        store.data.setCollection({ id: 'collection', data: [{ id: 1 }], total: 250 });
        const collection = wwCollection.collectionsById.collection;
        store.data.setCollection({ id: 'collection', total: 251 });
        expect(wwCollection.getCollections()).toBe(wwCollection.collectionsById);
        expect(wwCollection.getCollection('collection')).toBe(collection);
        expect(collection.total).toBe(251);
        store.data.collections = { replacement: { id: 'replacement', data: [], total: 0 } };
        expect(wwCollection.collectionsById.collection).toBeUndefined();
        expect(wwCollection.collectionsById.replacement).toBe(store.data.collections.replacement);
    });

    it('initializes native page parameters through the renamed resolver', () => {
        const { store, facade } = setup();
        store.websiteData.design.pages = [{ id: 'page', paths: { default: 'items/{{slug|fallback}}' } }];
        store.websiteData.pageId = 'page';
        const router = {
            currentRoute: { _value: { query: { 'wwParam-slug': 'editor' }, params: { slug: 'runtime' } } },
        };
        Object.assign(wwLib, { getEditorRouter: () => router, getFrontRouter: () => router });
        store.data.setPageParameterVariables();
        expect(store.data.pageParameterVariables.slug).toMatchObject({ id: 'slug', pageId: 'page', value: 'runtime' });
        expect(facade.getters['data/getPageParameterVariablesFromId']('page')).toMatchObject([
            { id: 'slug', pageId: 'page', defaultValue: 'fallback' },
        ]);
    });
});
