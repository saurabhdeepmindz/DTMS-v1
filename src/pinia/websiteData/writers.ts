import type { StoreRegistry } from '@/pinia/storeRegistry';
import type { WebsiteDataStateRefs } from './state';
 import type { Collection, Workflow, Formula, LibraryItem, LibraryComponent } from '../entities';
import type {
    DataRecord,
    ComponentKind,
    ResponsiveContent,
    ComponentState,
    ComponentDefinition,
    Page,
    DesignInfo,
    PluginSettings,
    Plugin,
    HistoryAction,
    HistoryItem,
    ComponentPropertyUpdate,
    PageData,
    FullDesign,
} from '../entities';
import type { WebsiteDataState } from './state';
import * as _ from 'lodash-es';

 
import { getPath } from '@/_common/helpers/pathResolver';
import {
    assignDenseStyleSourceIds,
    createStyleSourceIdRegistry,
    isDenseStyleSourceId,
} from '@/_common/helpers/styleCompiler';

function ensureStyleSourceIds(
    styleSourceIdRegistry: WebsiteDataStateRefs['styleSourceIdRegistry'],
    sources: ComponentDefinition[]
) {
    styleSourceIdRegistry.value ||= createStyleSourceIdRegistry();
    assignDenseStyleSourceIds(sources.filter(Boolean), styleSourceIdRegistry.value);
}

 
/** Private hydration and history writers. Native consumers use the store's commands. */

export function useWebsiteDataWriters({
    stateRefs,
 }: {
    stateRefs: WebsiteDataStateRefs;
 }) {
    const writers = {
        /*=============================================m_ÔÔ_m=============================================\
        DESIGN
    \================================================================================================*/
        setFullDesign(designInfo: FullDesign): void {
            stateRefs.design.value.info = { ...designInfo, pages: undefined, plugins: undefined };

            for (const page of designInfo.pages) {
                stateRefs.design.value.pages.push(page);
            }

         },
        updateDesignInfo(designInfo: DesignInfo): void {
            stateRefs.design.value.info = { ...designInfo, _isFromSocket: undefined };

         },
        setFonts(fonts: DesignInfo['fonts']): void {
            stateRefs.design.value.info.fonts = fonts;

         },
 
        /*=============================================m_ÔÔ_m=============================================\
        PAGE
    \================================================================================================*/
        setPageData(data: PageData): void {
            // Atomic style manifests use page-local indexes. Capture the incoming dictionaries before
            // merging them into the long-lived store, whose insertion order can retain sources from a
            // previously visited page.
            ensureStyleSourceIds(stateRefs.styleSourceIdRegistry, [
                ...Object.values(data.sections),
                ...Object.values(data.wwObjects),
            ]);
            stateRefs.styleSourceUids.value = [...Object.keys(data.sections), ...Object.keys(data.wwObjects)];

            for (const sectionId in data.sections) {
                if (!stateRefs.sections.value[sectionId])
                    stateRefs.sections.value[sectionId] = data.sections[sectionId];
            }
            for (const wwObjectId in data.wwObjects) {
                if (!stateRefs.wwObjects.value[wwObjectId])
                    stateRefs.wwObjects.value[wwObjectId] = data.wwObjects[wwObjectId];
            }

            writers.setPageId(data.page.id);

            for (const page of stateRefs.design.value.pages) {
                if (page.id === data.page.id) {
                    /* wwFront:start */
                    for (const key in data.page) {
                        page[key] = data.page[key];
                    }
                    /* wwFront:end */
                    page.pageLoaded = true;
                } else {
                    page.pageLoaded = false;
                }
            }

            for (const sectionId in stateRefs.sections.value) {
                if (!data.sections[sectionId]) delete stateRefs.sections.value[sectionId];
            }
            for (const wwObjectId in stateRefs.wwObjects.value) {
                if (stateRefs.wwObjects.value[wwObjectId].parentSectionId && !data.wwObjects[wwObjectId])
                    delete stateRefs.wwObjects.value[wwObjectId];
            }

         },
        setPageId(id: WebsiteDataState['pageId']): void {
            stateRefs.pageId.value = id;

         },
 
        ensureStyleSourceIds(sources: ComponentDefinition[] = [], { runtime = false } = {}): void {
            /* wwFront:start */
            if (runtime) {
                const start = stateRefs.design.value.info?.runtimeStyleIdStart;
                // Older publications do not describe the full CSS id range. Keep their UID-based
                // runtime identity rather than risk colliding with an unloaded persisted source.
                if (!isDenseStyleSourceId(start)) return;
                const registry = stateRefs.styleSourceIdRegistry.value;
                const nextId = Math.max(registry.nextId, start);
                if (!Number.isSafeInteger(nextId + sources.length)) return;
                registry.nextId = nextId;
            }
            /* wwFront:end */
            ensureStyleSourceIds(stateRefs.styleSourceIdRegistry, sources);
        },

 
        /*=============================================m_ÔÔ_m=============================================\
        PLUGINS
    \================================================================================================*/
        addPlugin(plugin: Plugin): void {
            const pluginIndexFound = stateRefs.plugins.value.findIndex(elem => elem.name === plugin.name);
            if (pluginIndexFound !== -1) {
                const pluginFound = stateRefs.plugins.value[pluginIndexFound];
                const pluginMerge = pluginFound.isDev ? { ...pluginFound, ...plugin } : { ...plugin, ...pluginFound };
                stateRefs.plugins.value.splice(pluginIndexFound, 1, pluginMerge);
            } else {
                stateRefs.plugins.value.push({
                    id: plugin.id,
                    isDev: plugin.isDev,
                    isLoaded: plugin.isLoaded,
                    name: plugin.name,
                    namespace: plugin.namespace,
                    settings: plugin.settings,
                 });
            }
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
            const plugin = stateRefs.plugins.value.find(
                plugin => plugin.namespace === pluginId || plugin.id === pluginId
            );
            if (!plugin) return;
            if (settings) plugin.settings = settings;
            if (typeof isDev === 'boolean') plugin.isDev = isDev;
            if (typeof isLoaded === 'boolean') plugin.isLoaded = isLoaded;
        },
    };
    return writers;
}

export type WebsiteDataWriters = ReturnType<typeof useWebsiteDataWriters>;
