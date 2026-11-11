import { createTestCompatibilityStore, disposeTestRuntime, withStoreRegistry } from '@/pinia/testRegistry.test-support';
import { afterEach, expect, it, vi } from 'vitest';
import { createPinia, storeToRefs } from 'pinia';
import { isReactive, isRef, reactive } from 'vue';
import { useDataState } from './data/state';
import { useDataGetters } from './data/getters';
import { useDataWriters } from './data/writers';
import { useDataCommands } from './data/commands';
import { useWebsiteDataState } from './websiteData/state';
import { useWebsiteDataGetters } from './websiteData/getters';
import { useWebsiteDataWriters } from './websiteData/writers';
import { useWebsiteDataCommands } from './websiteData/commands';
import { useFrontState } from './front/state';
import { useFrontWriters } from './front/writers';
import { useFrontCommands } from './front/commands';
import { useLibrariesState } from './libraries/state';
import { useLibrariesWriters } from './libraries/writers';
import { useDevState } from './dev/state';
import { useDevWriters } from './dev/writers';
import { useDevCommands } from './dev/commands';
import { useManagerState } from './manager/state';
import { useManagerWriters } from './manager/writers';
import { onEditorStateEvent } from './editor/stateEvents';

afterEach(() => vi.unstubAllGlobals());

it.each(['websiteData', 'data', 'front', 'libraries', 'manager', 'dev'] as const)(
    'keeps %s writers outside reactive and serialized state, including after hydration',
    domain => {
        const { $pinia: owner, store: registry } = withStoreRegistry({});
        const store = registry[domain];
        expect(isReactive(store.writers)).toBe(false);
        expect(Object.hasOwn(store.$state, 'writers')).toBe(false);
        expect(Object.hasOwn(storeToRefs(store), 'writers')).toBe(false);
        const snapshot = JSON.parse(JSON.stringify(owner.state.value));
        expect(Object.hasOwn(snapshot[domain], 'writers')).toBe(false);
        const restored = createPinia();
        restored.state.value = snapshot;
        const hydrated = withStoreRegistry(wwLib, restored).store[domain];
        expect(Object.keys(hydrated.writers)).toEqual(Object.keys(store.writers));
        expect(hydrated.writers).not.toBe(store.writers);
        expect(isReactive(hydrated.writers)).toBe(false);
        expect(Object.hasOwn(hydrated.$state, 'writers')).toBe(false);
    }
);

it('creates independent refs for every domain, retaining deep reactive objects and raw style registries', () => {
    for (const useState of [
        useWebsiteDataState,
        useDataState,
        useFrontState,
        useLibrariesState,
        useManagerState,
        useDevState,
    ]) {
        const first = useState();
        const second = useState();
        for (const key of Object.keys(first)) {
            expect(isRef(first[key])).toBe(true);
            expect(first[key]).not.toBe(second[key]);
            const value = first[key].value;
            // The published classes fixture is injected once per bundle; all other defaults are created here.
            if (value && typeof value === 'object' && !(useState === useLibrariesState && key === 'classes'))
                expect(value).not.toBe(second[key].value);
        }
    }
    expect(isReactive(useWebsiteDataState().styleSourceIdRegistry.value)).toBe(false);
    expect(isReactive(useWebsiteDataState().design.value)).toBe(true);
});

it('runs data commands and writers on supplied refs without initializing its own store, including registry replacement', () => {
    const pinia = createPinia();
    const stateRefs = useDataState();
    const getters = useDataGetters(stateRefs);
    const writers = useDataWriters({ stateRefs });
    const commands = useDataCommands({ stateRefs, getters, writers });
    commands.setFormulas([null, { id: 'formula', name: 'First' }]);
    commands.initGlobalWorkflows([null, { id: 'workflow', name: 'First' }]);
    expect(stateRefs.formulas.value.formula.name).toBe('First');
    expect(stateRefs.globalWorkflows.value.workflow.name).toBe('First');
    stateRefs.formulas.value = {};
    commands.setFormulas([{ id: 'formula', name: 'Second' }]);
    expect(getters.allFormulas.value.formula.name).toBe('Second');
    const rows = [{ id: 'row' }];
    commands.setCollection({ id: 'collection', data: reactive(rows), total: 50 });
    expect(stateRefs.collections.value.collection.data).toBe(rows);
    expect(isReactive(stateRefs.collections.value.collection.data)).toBe(false);
    stateRefs.collections.value = {};
    commands.setCollection({ id: 'collection', data: rows, total: 100 });
    expect(stateRefs.collections.value.collection.total).toBe(100);
    expect(pinia.state.value).toEqual({});
});

it('composes writers against supplied refs and emits the editor state events', () => {
    const owner = createPinia();
    const events: string[] = [];
    onEditorStateEvent(event => events.push(event.type));
    const websiteRefs = useWebsiteDataState();
    const getters = useWebsiteDataGetters(websiteRefs);
    const websiteWriters = useWebsiteDataWriters({ stateRefs: websiteRefs, getters });
    const websiteCommands = useWebsiteDataCommands({
        stateRefs: websiteRefs,
        getters,
        writers: websiteWriters,
    });
    websiteWriters.updateDesignInfo({ id: 'design', homePageId: 'home' });
    websiteCommands.setPageId(null);
    expect(websiteRefs.pageId.value).toBe('home');
    websiteRefs.design.value = { info: { id: 'replacement' }, pages: [] };
    websiteWriters.setFonts([]);
    expect(websiteRefs.design.value.info.fonts).toEqual([]);
    const frontRefs = useFrontState();
    const frontWriters = useFrontWriters({ stateRefs: frontRefs });
    const frontCommands = useFrontCommands({ writers: frontWriters });
    frontCommands.setIsScreenSizeActive({ screenSize: 'mobile', isActive: true });
    expect(frontRefs.isScreenSizeActive.value.mobile).toBe(true);
    const libraries = useLibrariesState();
    const libraryWriters = useLibrariesWriters({ stateRefs: libraries });
    libraries.classes.value = {};
    libraryWriters.setClass({ id: 'class', name: 'Class' });
    expect(libraries.classes.value.class.name).toBe('Class');
    const devRefs = useDevState();
    const devCommands = useDevCommands({ writers: useDevWriters({ stateRefs: devRefs }) });
    devCommands.addComponent({ type: 'elements', component: { port: 8080 } });
    expect(devRefs.elements.value).toHaveLength(1);
    devCommands.clearComponents('elements');
    expect(devRefs.elements.value).toEqual([]);
    const managerRefs = useManagerState();
    const managerWriters = useManagerWriters({ stateRefs: managerRefs });
    managerWriters.setIsIframeFull(false);
    expect(managerRefs.isIframeFull.value).toBe(false);
    expect(events).toEqual([
        'websiteData/updateDesignInfo',
        'websiteData/setPageId',
        'websiteData/setFonts',
        'front/setIsScreenSizeActive',
    ]);
    expect(owner.state.value).toEqual({});
});

it('hydrates native state and keeps captured pagination selectors reactive to patching', () => {
    const pinia = createPinia();
    pinia.state.value.data = {
        ...Object.fromEntries(Object.entries(useDataState()).map(([key, value]) => [key, value.value])),
        collections: { restored: { id: 'restored', total: 40, limit: 10 } },
    };
    const registry = withStoreRegistry({ wwFormula: { getValue: (value: unknown) => value } }, pinia).store;
    const pagination = registry.data.resolvePaginationOptions;
    expect(pagination('restored').total).toBe(40);
    registry.data.$patch({ collections: { restored: { id: 'restored', total: 300, limit: 20 } } });
    expect(pagination('restored')).toEqual({ total: 300, limit: 20, offset: 0 });
});

it.each([
    ['websiteData', 'setPageId', 'new-page', store => store.pageId],
    ['data', 'setCollection', { id: 'new', total: 200 }, store => store.collections.new?.total],
    ['front', 'setTheme', 'dark', store => store.theme],
    ['libraries', 'setClass', { id: 'new', name: 'New' }, store => store.classes.new?.name],
    ['manager', 'setIsIframeFull', false, store => store.isIframeFull],
    ['dev', 'addComponent', { type: 'elements', component: { port: 8080 } }, store => store.elements.length],
])(
    'keeps %s compatibility commits on the runtime state and starts clean after disposal',
    (domain, mutation, payload, read) => {
        const runtime = withStoreRegistry({});
        const facade = createTestCompatibilityStore(runtime.$pinia);
        const current = runtime.store[domain];
        if (domain === 'libraries') current.classes = {};
        const initial = read(current);
        facade.commit(`${domain}/${mutation}`, payload);
        expect(read(current)).not.toEqual(initial);
        disposeTestRuntime();
        const fresh = withStoreRegistry({});
        if (domain === 'libraries') fresh.store.libraries.classes = {};
        expect(read(fresh.store[domain])).toEqual(initial);
        const freshFacade = createTestCompatibilityStore(fresh.$pinia);
        freshFacade.commit(`${domain}/${mutation}`, payload);
        expect(read(fresh.store[domain])).not.toEqual(initial);
    }
);
