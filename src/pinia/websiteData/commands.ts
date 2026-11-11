import type { WebsiteDataGetters } from './getters';
import type { WebsiteDataStateRefs } from './state';
import type { TemplateOptions, TemplateResult, ComponentTemplate } from './templateTypes';
import type {
    Registry,
    DataRecord,
    ComponentKind,
    ResponsiveContent,
    ComponentState,
    ComponentDefinition,
    DesignInfo,
    PluginSettings,
    Plugin,
    Collection,
    Formula,
    Workflow,
    LibraryComponent,
    HistoryItem,
    ComponentPropertyUpdate,
    PageData,
    FullDesign,
    LayoutOwner,
} from '../entities';
import type { WebsiteDataState } from './state';
import * as _ from 'lodash-es';
 
 
import { cloneDeep } from 'lodash-es';

 
/** Commands are the native Pinia actions; this composable receives their private dependencies. */
export function useWebsiteDataCommands({
    stateRefs,
    getters,
    writers,
}: {
    stateRefs: Pick<WebsiteDataStateRefs, 'history' | 'design' | 'pageId' | 'wwObjects' | 'sections'>;
    getters: Pick<WebsiteDataGetters, 'designInfo' | 'pluginsById'>;
    writers: WebsiteDataWriters;
}) {
     const commands = {
        /*=============================================m_ÔÔ_m=============================================\
      DESIGN
    \================================================================================================*/
        async setFullDesign(designInfo: FullDesign): Promise<void> {
            writers.setFullDesign(designInfo);
            for (const plugin of designInfo.plugins) writers.addPlugin(plugin);
        },
 
 
        /*=============================================m_ÔÔ_m=============================================\
      PAGE
    \================================================================================================*/
         /* wwFront:start */
        async setAllData(data: {
            page: PageData;
            variables: Array<{ id: string; defaultValue?: unknown }>;
            collections?: Collection[];
            workflows?: Workflow[];
            formulas?: Formula[];
            libraryComponents?: LibraryComponent[];
        }): Promise<void> {
            const variablesStore = wwLib.store.variables;
            if (data.collections) wwLib.store.data.setNewCollections(data.collections);
            for (const variable of data.variables) {
                if (!variablesStore.getConfiguration(variable.id)) {
                    variablesStore.add('website', variable.id, variable);
                    variablesStore.values[variable.id] = cloneDeep(variable.defaultValue);
                }
            }
            if (data.formulas) wwLib.store.data.setFormulas(data.formulas);
            if (data.workflows) wwLib.store.data.setGlobalWorkflows(data.workflows);
            if (data.libraryComponents) wwLib.store.libraries.setComponents(data.libraryComponents);
            writers.setPageData(data.page);
            const sectionIds = Object.keys(data.page.sections);
            variablesStore.cleanComponent(sectionIds);
        },
        /* wwFront:end */
         setPageId(pageId: WebsiteDataState['pageId']): void {
            writers.setPageId(pageId || getters.designInfo.value.homePageId);
        },
        setPageIdFromRoute(route: string): void {
            const langs = stateRefs.design.value.info.langs.map(langData => langData.lang);

            function correctRoute(_route) {
                if (_route && _route[0] == '/') _route = _route.substring(1);
                if (_route && _route[_route.length - 1] == '/') _route = _route.substring(0, _route.length - 1);

                for (const lang of langs) {
                    if (_route && _route.indexOf(lang + '/') === 0) _route = _route.substring(lang.length + 1);
                    if (_route && _route == lang) _route = '@home';
                }
                return _route;
            }
            const routes = {};
            route = correctRoute(route) || '@home';

            for (const page of stateRefs.design.value.pages) {
                if (page.id == stateRefs.design.value.info.homePageId) {
                    routes['@home'] = page.id;
                    routes['/'] = page.id;
                } else {
                    for (const lang of page.langs) {
                        routes[correctRoute(page.paths[lang] || page.paths.default)] = page.id;
                    }
                }
            }

            if (routes[route]) {
                writers.setPageId(routes[route]);
            } else if (routes['404']) {
                writers.setPageId(routes['404']);
            } else {
                writers.setPageId(routes['@home']);
            }
        },

 
        /*=============================================m_ÔÔ_m=============================================\
        PLUGINS
    \================================================================================================*/
        addPlugin(plugin: Plugin): Plugin {
            writers.addPlugin(plugin);
            return plugin;
        },
        addDevPlugin({ id, name, namespace }: { id: string; name: string; namespace: string }): Plugin {
            const plugin = {
                id,
                name,
                namespace: namespace || id,
                repository: {},
                icon: 'code',
                isDev: true,
                settings: {
                    publicData: {},
                    privateData: {},
                },
            };
            writers.addPlugin(plugin);
            return plugin;
        },
        updatePlugin({
            pluginId,
            settings,
            isDev,
            isLoaded,
        }: {
            pluginId: string;
            settings: PluginSettings;
            isDev?: boolean;
            isLoaded?: boolean;
        }): void {
            writers.updatePlugin({ pluginId, settings, isDev, isLoaded });
        },
        async updatePluginSettings({
            pluginId,
            settings,
        }: {
            pluginId: string;
            settings: PluginSettings;
        }): Promise<void> {
            if (!settings) return;
            const plugin = getters.pluginsById.value[pluginId];
            if (plugin && !import.meta.env.VITE_APP_IS_EDITOR_DEV)
                await window.wwLib.wwPlugin.saveSettings(
                    pluginId,
                    settings.id,
                    settings.publicData,
                    settings.privateData
                );
            writers.updatePlugin({ pluginId, settings });
        },
         ensureStyleSourceIds: writers.ensureStyleSourceIds,
    };
    return commands;
}

export type WebsiteDataCommands = ReturnType<typeof useWebsiteDataCommands>;
