import { createTestCompatibilityStore } from '@/pinia/testRegistry.test-support';
import { withStoreRegistry } from '@/pinia/testRegistry.test-support';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, defineStore, setActivePinia, storeToRefs } from 'pinia';
import { createSSRApp, effectScope, h, nextTick, ref, watchEffect } from 'vue';
import { renderToString } from '@vue/server-renderer';

import { createLegacyStore } from './legacyStore';
import { useWebsiteDataStore } from '@/pinia/websiteData';
import { useDataStore } from '@/pinia/data';
import { useManagerStore } from '@/pinia/manager';
import { useFrontStore } from '@/pinia/front';
import { onEditorStateEvent } from '@/pinia/editor/stateEvents';
import wwEditorHistory from '@/wwLib/servicesManager/wwEditorHistory.js';
import {
    useStore,
    mapState,
    mapGetters,
    mapActions,
    mapMutations,
    createNamespacedHelpers,
} from './__fixtures__/vuex4-helpers';

beforeEach(() => {
    const pinia = createPinia();
    setActivePinia(pinia);
    withStoreRegistry(wwLib, pinia);
    vi.stubGlobal('localStorage', { setItem: vi.fn() });
    wwLib.wwEditorHistory = wwEditorHistory;
});

describe('historical components on native Pinia state', () => {
    it('keeps native-only commands out of the frozen historical contract', () => {
        const pinia = createPinia();
        const native = useWebsiteDataStore(pinia);
        const load = vi.spyOn(native, 'loadWwObject');
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        const facade = createTestCompatibilityStore(pinia);
        expect(facade.dispatch('websiteData/loadWwObject', 'element')).toBeUndefined();
        expect(load).not.toHaveBeenCalled();
        expect(error).toHaveBeenCalledWith('[WeWeb compatibility] Unknown action: websiteData/loadWwObject');
        expect('setWwObjectState' in native).toBe(false);
        expect('undoState' in native).toBe(false);
        error.mockRestore();
    });

    it('keeps native refs and legacy getters reactive when a registry is replaced', async () => {
        const pinia = createPinia();
        const facade = createTestCompatibilityStore(pinia);
        const website = useWebsiteDataStore(pinia);
        const { sections } = storeToRefs(website);
        const reads = vi.fn();
        const scope = effectScope();
        scope.run(() => watchEffect(() => reads(sections.value, facade.getters['websiteData/getSections'])));

        website.sections = { first: { uid: 'first' } };
        await nextTick();
        expect(reads).toHaveBeenCalledTimes(2);
        expect(reads).toHaveBeenLastCalledWith(website.sections, website.sections);
        expect(website.$state.sections).toBe(sections.value);

        facade.state.websiteData.sections = { second: { uid: 'second' } };
        await nextTick();
        expect(reads).toHaveBeenCalledTimes(3);
        expect(reads).toHaveBeenLastCalledWith(website.sections, website.sections);
        scope.stop();
    });

    it('resolves cross-domain computed values from the current project', () => {
        const front = wwLib.store.front;
        const website = wwLib.store.websiteData;
        website.design.info = { defaultTheme: 'light' };
        expect(front.resolvedTheme).toBe('light');
        website.design.info.defaultTheme = 'custom';
        expect(front.resolvedTheme).toBe('custom');
    });

    it('shares references and invalidates only readers of the modified object', async () => {
        const pinia = createPinia();
        const facade = createTestCompatibilityStore(pinia);
        const website = useWebsiteDataStore(pinia);
        website.setWwObject({ uid: 'a', content: { default: { label: 'A' } } });
        website.setWwObject({ uid: 'b', content: { default: { label: 'B' } } });
        expect(facade.state.websiteData).toBe(website.$state);
        expect(facade.getters['websiteData/getWwObjects']).toBe(website.wwObjects);
        const reads = [vi.fn(), vi.fn()];
        const scope = effectScope();
        scope.run(() => {
            watchEffect(() => reads[0](facade.getters['websiteData/getWwObjects'].a.content.default.label));
            watchEffect(() => reads[1](website.wwObjects.b.content.default.label));
        });
        facade.commit('websiteData/setComponentProperty', {
            type: 'element',
            uid: 'a',
            path: 'content.label',
            value: 'Updated',
        });
        await nextTick();
        expect(reads[0]).toHaveBeenLastCalledWith('Updated');
        expect(reads[0]).toHaveBeenCalledTimes(2);
        expect(reads[1]).toHaveBeenCalledTimes(1);
        scope.stop();
    });

    it('supports already-bundled namespaced helpers and injected useStore without Vuex', async () => {
        const pinia = createPinia();
        const facade = createTestCompatibilityStore(pinia);
        facade.commit('front/setLang', 'fr');
        const mapped = createNamespacedHelpers('front');
        const app = createSSRApp({
            setup() {
                return { injected: useStore() };
            },
            computed: {
                ...mapState('front', { language: 'lang' }),
                ...mapGetters({ rootLanguage: 'front/getLang' }),
                ...mapped.mapGetters({ localLanguage: 'getLang' }),
            },
            render() {
                return h(
                    'div',
                    [this.language, this.rootLanguage, this.localLanguage, this.injected === facade].join(':')
                );
            },
        });
        app.use(pinia);
        app.use(facade);
        expect(await renderToString(app)).toBe('<div>fr:fr:fr:true</div>');
        const component = { $store: facade };
        const change = mapMutations('front', { change: 'setLang' }).change.bind(component);
        expect(change('es')).toBeUndefined();
        expect(useFrontStore(pinia).lang).toBe('es');
        const setLanguage = mapActions('front', ['setLang']).setLang.bind(component);
        const result = setLanguage('it');
        expect(result).toBeInstanceOf(Promise);
        await result;
        expect(facade.getters['front/getLang']).toBe('it');
    });

    it('preserves object-style payloads, root dispatch, values and rejections', async () => {
        const useTestStore = defineStore('compat-test', () => {
            const value = ref(null);
            function save(payload) {
                value.value = payload;
                return payload;
            }
            function fail() {
                throw new Error('expected failure');
            }
            return { value, save, fail };
        });
        const store = useTestStore();
        const facade = createLegacyStore({
            test: { store, getters: {}, actions: { save: 'save', fail: 'fail' }, mutations: { save: 'save' } },
        });
        const payload = { type: 'test/save', value: 42 };
        facade.commit(payload);
        expect(store.value).toEqual(payload);
        await expect(facade._modulesNamespaceMap['test/'].context.dispatch(payload, { root: true })).resolves.toEqual(
            payload
        );
        await expect(facade.dispatch('test/fail')).rejects.toThrow('expected failure');
        expect('subscribe' in facade).toBe(false);
        expect('registerModule' in facade).toBe(false);
    });

    it('keeps collection data identity and independent total when called through either API', async () => {
        const pinia = createPinia();
        const facade = createTestCompatibilityStore(pinia);
        const data = useDataStore(pinia);
        const rows = [{ id: 1 }];
        await facade.dispatch('data/setCollection', { id: 'collection', data: rows, total: 250 });
        expect(data.collections.collection.data).toBe(rows);
        expect(data.collections.collection.total).toBe(250);
        const collection = data.collections.collection;
        await data.setCollection({ id: 'collection', total: 251 });
        expect(facade.getters['data/getCollections'].collection).toBe(collection);
        expect(collection.data).toBe(rows);
    });

    it('emits empty history commands synchronously and supports unsubscribe', () => {
        const listener = vi.fn();
        const unsubscribe = onEditorStateEvent(listener);
        const payload = { historyItem: { actions: [] }, direction: 'redo' as const };
        wwLib.store.websiteData.writers.sendHistory(payload);
        expect(listener).toHaveBeenCalledExactlyOnceWith({ type: 'websiteData/sendHistory', payload });
        unsubscribe();
        wwLib.store.websiteData.writers.sendHistory(payload);
        expect(listener).toHaveBeenCalledOnce();
    });

    it('applies an undo before publishing its save and replays redo in order', async () => {
        const pinia = createPinia();
        const store = useWebsiteDataStore(pinia);
        store.setWwObject({ uid: 'a', content: { default: { label: 'After' } } });
        const snapshot = { uid: 'a', content: { default: { label: 'Before' } } };
        const current = { uid: 'a', content: { default: { label: 'After' } } };
        store.history.undo.push({
            actions: [{ type: wwEditorHistory.TYPES.WWOBJECT, uid: 'a', oldData: snapshot, newData: current }],
        });
        const values: unknown[] = [];
        onEditorStateEvent(event => {
            if (event.type === 'websiteData/sendHistory') values.push(store.wwObjects.a.content.default.label);
        });
        await store.undo();
        await store.redo();
        expect(values).toEqual(['Before', 'After']);
    });
});

describe('typed native actions and historical mutation names', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        wwEditorHistory.historiesToBeAdded = [];
        wwEditorHistory.adding = false;
    });
    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
        wwEditorHistory.historiesToBeAdded = [];
        wwEditorHistory.adding = false;
    });

    it('keeps section visual states separate from page layout through both APIs', async () => {
        const pinia = createPinia();
        withStoreRegistry(wwLib, pinia);
        const website = useWebsiteDataStore(pinia);
        const facade = createTestCompatibilityStore(pinia);
        useManagerStore(pinia).aiQueriesHistory = [];
        website.pageId = 'page';
        website.design.pages = [{ id: 'page', sections: [] }];
        website.sections = { section: { uid: 'section', _state: { states: [] } } };

        facade.commit('websiteData/addSection', { sectionId: 'section' });
        await website.addSectionState({ sectionId: 'section', state: { id: 'hover' } });
        expect(website.page.sections).toHaveLength(1);
        expect(website.sections.section._state.states).toEqual([{ id: 'hover' }]);
        await facade.dispatch('websiteData/deleteSectionState', { sectionId: 'section', stateId: 'hover' });
        expect(website.sections.section._state.states).toEqual([]);
        expect(website.page.sections).toHaveLength(1);

        await facade.dispatch('websiteData/addSectionState', { sectionId: 'section', state: { id: 'active' } });
        await website.deleteSectionState({ sectionId: 'section', stateId: 'active' });
        facade.commit('websiteData/deleteSection', { sectionId: 'section' });
        expect(website.page.sections).toEqual([]);
        expect(website.sections.section._state.states).toEqual([]);
    });

    it('passes root section content through the action and snapshots its value', async () => {
        const website = useWebsiteDataStore();
        useManagerStore().aiQueriesHistory = [];
        website.sections = { section: { uid: 'section', content: {} } };
        const content = { default: { label: 'Updated' } };
        await website.setSectionRootContent({ sectionId: 'section', rootContent: content });
        content.default.label = 'Changed outside the store';
        expect(website.sections.section.content).toEqual({ default: { label: 'Updated' } });
    });

    it('removes empty remote selection entries after moving or disconnecting', () => {
        const manager = useManagerStore();
        manager.user = { socketId: 'local' };
        manager.setUsers([{ socketId: 'remote', objectSelected: 'first' }]);
        manager.setUsersObjectSelected({ socketId: 'remote', uid: 'second' });
        expect(manager.usersSelection.first).toBeUndefined();
        expect(manager.usersSelection.second).toHaveLength(1);
        manager.removeUsers({ socketId: 'remote' });
        expect(manager.usersSelection.second).toBeUndefined();
        expect(manager.users).toEqual([]);
    });
});
