import { computed } from 'vue';
import { indexByFirst } from '../indexByFirst';

import type {
    HistoryItem,
    ComponentKind,
    ResponsiveContent,
    ComponentState,
    ComponentDefinition,
    Page,
    DesignInfo,
    Design,
    PluginSettings,
    Plugin,
    HistoryDetail,
} from '../entities';
import type { WebsiteDataStateRefs } from './state';
import * as _ from 'lodash-es';

import utils from './utils';
 
/** Derive values from this application's existing state refs. */
export function useWebsiteDataGetters(refs: WebsiteDataStateRefs) {
    const currentDesign = computed((): Design | null => {
        if (!refs.design.value) {
            return null;
        }

        return refs.design.value;
    });
    const designInfo = computed((): DesignInfo => {
        if (!refs.design.value || !refs.design.value.info) {
            return {};
        }

        return refs.design.value.info;
    });
     const pages = computed((): Page[] => {
         // eslint-disable-next-line no-unreachable
        return refs.design.value.pages;
    });
     const page = computed((): Page | undefined => refs.design.value.pages.find(page => page.id === refs.pageId.value));
    const pagesById = computed((): Record<string, Page> => indexByFirst(refs.design.value.pages, page => [page.id]));
    const pagesByLinkId = computed(
        (): Record<string, Page> => indexByFirst(refs.design.value.pages, page => [page.linkId, page.id])
    );
    const fullPage = computed((): Page | null => {
        return utils.getFullPage({
            design: refs.design.value,
            pageId: refs.pageId.value,
            sections: refs.sections.value,
            wwObjects: refs.wwObjects.value,
        });
    });
    const resolveComponentStateIds = computed(() => ({ type, uid }: { type: ComponentKind; uid: string }): string[] => {
        let _state;
        if (type === 'section') {
            _state = (refs.sections.value[uid] && refs.sections.value[uid]._state) || {};
        } else {
            _state = (refs.wwObjects.value[uid] && refs.wwObjects.value[uid]._state) || {};
        }
        return (_state.states || []).map(state => state.id);
    });
    const resolveComponentStates = computed(
        () =>
            ({ type, uid }: { type: ComponentKind; uid: string }): ComponentState[] => {
                let _state;
                if (type === 'section') {
                    _state = (refs.sections.value[uid] && refs.sections.value[uid]._state) || {};
                } else {
                    _state = (refs.wwObjects.value[uid] && refs.wwObjects.value[uid]._state) || {};
                }
                return _state.states || [];
            }
    );
    const resolveObjectStyle = computed(() => (id: string): ResponsiveContent => {
        const { _state = {} } = refs.wwObjects.value[id] || {};
        return _state.style || {};
    });
    const resolveFullObject = computed(
        () =>
            (uid: string, asTemplate: boolean = false): Partial<ComponentDefinition> => {
                return utils.parseFullObject(
                    { wwObjects: refs.wwObjects.value },
                    { uid, isWwObject: true },
                    asTemplate
                ) as Partial<ComponentDefinition>;
            }
    );
    const resolveSectionTitle = computed(() => (uid: string): string | undefined => {
        return refs.design.value.pages
            .map(page => page.sections || [])
            .flat()
            .find(section => section.uid === uid)?.sectionTitle;
    });
    const resolveSectionState = computed(() => (id: string): ComponentDefinition['_state'] => {
        const { _state } = refs.sections.value[id] || {};
        return _state || {};
    });
    const resolveFullSection = computed((): ((uid: string) => ComponentDefinition | null) => {
        return function (sectionId) {
            if (refs.sections.value[sectionId]) {
                let section = _.cloneDeep(refs.sections.value[sectionId]);
                return utils.parseFullObject({ wwObjects: refs.wwObjects.value }, section) as ComponentDefinition;
            }
            return null;
        };
    });
    const isSectionLinked = computed(
        () =>
            (sectionId: string): boolean =>
                refs.design.value.pages
                    .map(page => page.sections || [])
                    .flat()
                    .filter(section => section.uid === sectionId).length > 1
    );
     const pluginsByComponentId = computed(
        (): Record<string, Plugin> =>
            indexByFirst(refs.plugins.value, plugin => [plugin.id ? `plugin-${plugin.id}` : undefined])
    );
    const pluginsByNamespace = computed(
        (): Record<string, Plugin> => indexByFirst(refs.plugins.value, plugin => [plugin.namespace])
    );
    const pluginsById = computed(
        (): Record<string, Plugin> => indexByFirst(refs.plugins.value, plugin => [plugin.id || undefined])
    );
    const authPlugin = computed((): Plugin | undefined => {
        return refs.plugins.value.find(plugin => plugin.id === refs.design.value?.info?.authPluginId);
    });
    const resolvePluginSettings = computed(() => (id: string): PluginSettings | undefined => {
        const plugin = pluginsById.value[id];
        return plugin && plugin.settings;
    });
    const isPluginLoaded = computed(() => (id: string): boolean | undefined => {
        const plugin = pluginsById.value[id];
        return plugin && plugin.isLoaded;
    });

    return {
        currentDesign,
        designInfo,
         pages,
         page,
        pagesById,
        pagesByLinkId,
        fullPage,
        resolveComponentStateIds,
        resolveComponentStates,
        resolveObjectStyle,
        resolveFullObject,
        resolveSectionTitle,
        resolveSectionState,
        resolveFullSection,
        isSectionLinked,
         pluginsByComponentId,
        pluginsByNamespace,
        pluginsById,
        authPlugin,
        resolvePluginSettings,
        isPluginLoaded,
    };
}

export type WebsiteDataGetters = ReturnType<typeof useWebsiteDataGetters>;
