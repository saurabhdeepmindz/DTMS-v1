import { withStoreRegistry } from './testRegistry.test-support';
import { afterEach, expect, it, vi } from 'vitest';
import { createPinia } from 'pinia';
import { useDataState } from './data/state';
import { useFrontState } from './front/state';
import { useWebsiteDataState } from './websiteData/state';
import { useDataGetters } from './data/getters';
import { useFrontGetters } from './front/getters';
import { useWebsiteDataGetters } from './websiteData/getters';
import { useManagerState } from './manager/state';
import { useLibrariesState } from './libraries/state';
import { useDevState } from './dev/state';
import { useManagerGetters } from './manager/getters';
import { useLibrariesGetters } from './libraries/getters';
import { useDevGetters } from './dev/getters';

afterEach(() => vi.unstubAllGlobals());

it('derives data from supplied refs without creating its own store, including captured resolvers after replacement', () => {
    const pinia = createPinia();
    const refs = useDataState();
    vi.stubGlobal('wwLib', { wwFormula: { getValue: (value: unknown) => value } });
    const getters = useDataGetters(refs);
    const pagination = getters.resolvePaginationOptions.value;
    const folders = getters.resolveBackendWorkflowFolders.value;
    refs.collections.value = { collection: { id: 'collection', total: 250, limit: '20', offset: 5 } };
    expect(pagination('collection')).toEqual({ total: 250, limit: 20, offset: 5 });
    refs.collections.value = { collection: { id: 'collection', total: 300, limit: '10' } };
    expect(pagination('collection')).toEqual({ total: 300, limit: 10, offset: 0 });
    refs.globalWorkflows.value = { backend: { id: 'backend', type: 'back', folder: 'First' } };
    expect(folders()).toEqual([{ label: 'First', value: 'First' }]);
    refs.globalWorkflows.value = { backend: { id: 'backend', type: 'back', folder: 'Second' } };
    expect(folders()).toEqual([{ label: 'Second', value: 'Second' }]);
    refs.formulas.value = { formula: { id: 'formula', name: 'Native' } };
    refs.pluginFormulas.value = { formula: { id: 'formula', name: 'Plugin' } };
    expect(getters.allFormulas.value.formula).toBe(refs.pluginFormulas.value.formula);
    refs.pluginFormulas.value = {};
    expect(getters.allFormulas.value.formula).toBe(refs.formulas.value.formula);
    expect(pinia.state.value).toEqual({});
});

it('expands full objects and pages from the current supplied registries without a website store', () => {
    const pinia = createPinia();
    const refs = useWebsiteDataState();
    const getters = useWebsiteDataGetters(refs);
    const fullObject = getters.resolveFullObject.value;
    const fullSection = getters.resolveFullSection.value;
    refs.pageId.value = 'page';
    refs.design.value.pages = [{ id: 'page', sections: [{ uid: 'section' }] }];
    refs.sections.value = {
        section: { uid: 'section', content: { default: { child: { uid: 'element', isWwObject: true } } } },
    };
    refs.wwObjects.value = { element: { uid: 'element', name: 'Before' } };
    expect(fullObject('element')).toMatchObject({ uid: 'element', name: 'Before' });
    refs.wwObjects.value = { element: { uid: 'element', name: 'After' } };
    expect(fullObject('element')).toMatchObject({ uid: 'element', name: 'After' });
    expect(fullSection('section')).toMatchObject({
        content: { default: { child: { uid: 'element', name: 'After' } } },
    });
    expect(getters.fullPage.value.sections[0]).toMatchObject({
        content: { default: { child: { uid: 'element', name: 'After' } } },
    });
    expect(pinia.state.value).toEqual({});
});

it('reads the current project while resolving local computed dependencies from supplied refs', () => {
    const owner = createPinia();
    const a = withStoreRegistry({}, owner).store;
    a.websiteData.design.info = { defaultTheme: 'dark' };
    a.websiteData.pageId = 'owner';
    a.websiteData.design.pages = [{ id: 'owner', cmsDataSetPath: 'collection.data' }];
    const dataRefs = useDataState();
    const frontRefs = useFrontState();
    dataRefs.collections.value = { collection: { id: 'collection', data: ['first', 'second'] } };
    dataRefs.pageCollectionIndex.value = 1;
    const dataGetters = useDataGetters(dataRefs);
    const frontGetters = useFrontGetters(frontRefs);
    vi.stubGlobal('wwLib', { $pinia: owner, store: a });
    expect(dataGetters.pageCollectionData.value).toBe('second');
    expect(frontGetters.resolvedTheme.value).toBe('dark');
    dataRefs.pageCollectionIndex.value = 0;
    expect(dataGetters.pageCollectionData.value).toBe('first');
    frontRefs.theme.value = 'custom';
    expect(frontGetters.resolvedTheme.value).toBe('custom');
    expect(Object.hasOwn(owner.state.value, 'data')).toBe(false);
    expect(Object.hasOwn(owner.state.value, 'front')).toBe(false);
});

it('keeps manager, libraries and development getters current through replacement of their supplied refs', () => {
    const pinia = createPinia();
    const managerRefs = useManagerState();
    const libraryRefs = useLibrariesState();
    const devRefs = useDevState();
    const manager = useManagerGetters(managerRefs);
    const libraries = useLibrariesGetters(libraryRefs);
    const dev = useDevGetters(devRefs);
    const isOpen = manager.isPopupSidebarOpen.value;
    const byPort = dev.resolveComponentByPort.value;
    const components = dev.listComponents.value;
    managerRefs.popupSidebars.value = [{ name: 'NAVIGATOR', options: { closed: false } }];
    expect(isOpen('NAVIGATOR')).toBe(true);
    expect(manager.isNavigatorOpened.value).toBe(true);
    managerRefs.popupSidebars.value = [{ name: 'NAVIGATOR', options: { closed: true } }];
    expect(isOpen('NAVIGATOR')).toBe(false);
    expect(manager.isNavigatorOpened.value).toBe(false);
    libraryRefs.classes.value = { class: { id: 'class', name: 'Before', libraryId: 'old' } };
    expect(libraries.classesFromLibrary.value.old[0]).toBe(libraryRefs.classes.value.class);
    libraryRefs.classes.value = { class: { id: 'class', name: 'After', libraryId: 'new' } };
    expect(libraries.classesFromLibrary.value.old).toBeUndefined();
    expect(libraries.classesFromLibrary.value.new[0]).toBe(libraryRefs.classes.value.class);
    devRefs.elements.value = [{ wwObjectBaseId: 'before', port: 8080 }];
    expect(byPort(8080)?.component.name).toBe('before');
    expect(components('elements')).toBe(devRefs.elements.value);
    devRefs.elements.value = [{ wwObjectBaseId: 'after', port: 8080 }];
    expect(byPort('8080')?.component.name).toBe('after');
    expect(components('elements')).toBe(devRefs.elements.value);
    expect(pinia.state.value).toEqual({});
});
