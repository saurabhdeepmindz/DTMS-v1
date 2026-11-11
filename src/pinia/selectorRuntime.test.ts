import { withStoreRegistry, createTestCompatibilityStore } from './testRegistry.test-support';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia } from 'pinia';

import wwEditorHistory from '@/wwLib/servicesManager/wwEditorHistory';
import type { HistoryItem } from './entities';

beforeEach(() => vi.stubGlobal('__WW_STORE_FRONT_COMPONENT_CONFIGS__', {}));

describe('native selectors in the editor runtime', () => {
    it('resolves mixed undo and redo labels from the project stores', () => {
        const pinia = createPinia();
        const registry = withStoreRegistry({ wwEditorHistory }, pinia).store;

        registry.variables.website['shared'] = { id: 'shared', name: 'Project variable' };
        registry.data.formulas.shared = { id: 'shared', name: 'Project formula' };
        registry.data.collections.shared = { id: 'shared', name: 'Project collection' };
        registry.data.globalWorkflows.shared = { id: 'shared', name: 'Project workflow' };
        registry.libraries.classes = { shared: { id: 'shared', name: 'Project class' } };
        registry.websiteData.sections.shared = { uid: 'shared', sectionTitle: 'Project section' };
        registry.websiteData.wwObjects.shared = { uid: 'shared', name: 'Project element' };
        registry.manager.aiQueriesHistory = [];
        const entry = (type: string, display = {}): HistoryItem => ({
            actions: [],
            date: 1,
            realDate: new Date(),
            display: { type, action: wwEditorHistory.ACTIONS.UPDATE, uid: 'shared', ...display },
        });
        registry.websiteData.history.undo = [
            'variable',
            'formula',
            'collection',
            'workflow',
            'library-class',
            'section',
            'wwobject',
        ].map(type => entry(type));
        registry.websiteData.history.redo = [
            entry('ai-resource-access', { resourceType: 'formula', resourceId: 'shared' }),
        ];
        const expected = [
            'formula Project formula',
            'element Project element',
            'section Project section',
            'library class Project class',
            'workflow Project workflow',
            'collection Project collection',
            'formula Project formula',
            'variable Project variable',
            '',
        ];
        expect(registry.websiteData.historyDetails.map(item => item.elementName)).toEqual(expected);
        expect(
            createTestCompatibilityStore(pinia).getters['websiteData/getHistory'].map(item => item.elementName)
        ).toEqual(expected);
    });
    it('uses project component configuration fallbacks and AI chat labels in history', () => {
        const pinia = createPinia();
        const registry = withStoreRegistry({ wwEditorHistory }, pinia).store;

        registry.websiteData.sections.shared = { uid: 'shared', sectionBaseId: 'base' };
        registry.componentBases.configurations['section-base'] = {
            name: 'section-base',
            editor: { label: { en: 'Project fallback' } },
        };
        registry.manager.aiQueriesHistory = [
            {
                id: 'query',
                chat: [
                    { id: 'user', role: 'user', content: 'Project prompt' },
                    { id: 'response', role: 'assistant' },
                ],
            },
        ];
        registry.websiteData.history.undo = [
            { actions: [], realDate: new Date(), display: { type: 'section', action: 'update', uid: 'shared' } },
            {
                actions: [],
                realDate: new Date(),
                display: { type: 'formula', action: 'update', uid: 'shared' },
                aiQueryId: 'query',
                aiQueryMessageId: 'response',
            },
        ];
        expect(registry.websiteData.historyDetails.map(item => item.elementName)).toEqual([
            'Project prompt',
            'section Project fallback',
            '',
        ]);
    });
    it('collects referenced entities from the current page', () => {
        const pinia = createPinia();
        const registry = withStoreRegistry({ wwEditorHistory }, pinia).store;

        registry.websiteData.design.pages = [{ id: 'project-page', sections: [{ uid: 'section' }] }];
        registry.websiteData.pageId = 'project-page';
        registry.websiteData.sections.section = {
            uid: 'section',
            content: { default: { text: 'project-collection project-formula project-variable' } },
        };
        registry.data.collections['project-collection'] = { id: 'project-collection' };
        registry.data.formulas['project-formula'] = { id: 'project-formula' };
        registry.variables.website['project-variable'] = { id: 'project-variable' };
        registry.editorUIState.loaderProgress = 100;
        const expected = ['project-collection', 'project-formula', 'project-variable'];
        expect(registry.manager.idsUsedInPage.toSorted()).toEqual(expected);
        expect(createTestCompatibilityStore(pinia).getters['manager/getIdsUsedInPage'].toSorted()).toEqual(expected);
    });
    it('keeps captured parameter resolvers reactive to the current page data', () => {
        const pinia = createPinia();
        const registry = withStoreRegistry({ wwEditorHistory }, pinia).store;
        registry.websiteData.design.pages = [{ id: 'page', paths: { default: '{{slug|first}}' } }];
        const resolve = registry.data.resolvePageParameterVariables;
        const historical = createTestCompatibilityStore(pinia).getters['data/getPageParameterVariablesFromId'];
        expect(resolve('page').map(parameter => parameter.id)).toEqual(['slug']);
        expect(historical('page').map(parameter => parameter.id)).toEqual(['slug']);
        registry.websiteData.design.pages = [{ id: 'page', paths: { default: '{{nextSlug|second}}' } }];
        expect(resolve('page').map(parameter => parameter.id)).toEqual(['nextSlug']);
        expect(historical('page').map(parameter => parameter.id)).toEqual(['nextSlug']);
    });

    it('uses installed plugin feature configurations', () => {
        const pinia = createPinia();
        const registry = withStoreRegistry({ wwEditorHistory }, pinia).store;
        registry.websiteData.plugins = [{ id: 'installed' }];
        registry.manager.plugins = [{ id: 'installed' }];
        registry.componentBases.configurations['plugin-installed'] = {
            name: 'plugin-installed',
            features: { datasource: true },
        };
        const installed = registry.websiteData.filterPluginsByFeature;
        const catalogue = registry.manager.filterPluginsByFeature;
        expect(installed('datasource')).toEqual([registry.websiteData.plugins[0]]);
        expect(catalogue('datasource')).toEqual([registry.manager.plugins[0]]);
    });

    it('resolves plugin actions and libraries from installed plugin configurations', () => {
        const pinia = createPinia();
        const registry = withStoreRegistry({ wwEditorHistory }, pinia).store;
        registry.websiteData.plugins = [{ id: 'installed' }];
        registry.componentBases.configurations['plugin-installed'] = {
            name: 'plugin-installed',
            actions: [{ code: 'execute' }],
            editor: { designSystemId: 'library' },
        };
        expect(registry.data.pluginActions['installed-execute']).toMatchObject({
            pluginId: 'installed',
            code: 'execute',
        });
        expect(registry.manager.pluginLibraries).toEqual([
            { plugin: registry.websiteData.plugins[0], designSystemId: 'library' },
        ]);
    });
});
