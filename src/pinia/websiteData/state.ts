import type { Registry, ComponentDefinition, Design, Plugin, HistoryItem } from '../entities';

import { createStyleSourceIdRegistry } from '@/_common/helpers/styleCompiler';
import { markRaw, ref, type UnwrapRef } from 'vue';

export function useWebsiteDataState() {
    return {
        /*=============================================m_ÔÔ_m=============================================\
        DESIGN
    \================================================================================================*/
        pageId: ref<string | null>(null),
        styleSourceUids: ref<string[]>([]),
        styleSourceIdRegistry: ref(markRaw(createStyleSourceIdRegistry())),
        design: ref<Design>({
            info: null,
            pages: [],
        }),

        /*=============================================m_ÔÔ_m=============================================\
        ELEMENTS
    \================================================================================================*/
        sections: ref<Registry<ComponentDefinition>>({}),
        wwObjects: ref<Registry<ComponentDefinition>>({}),
        wwObjectPreviewUids: ref<string[]>([]),

        /*=============================================m_ÔÔ_m=============================================\
        HISTORY
    \================================================================================================*/
        history: ref<{ undo: HistoryItem[]; redo: HistoryItem[] }>({
            undo: [],
            redo: [],
        }),

        /*=============================================m_ÔÔ_m=============================================\
        PLUGINS
    \================================================================================================*/
        plugins: ref<Plugin[]>([]),
    };
}

export type WebsiteDataStateRefs = ReturnType<typeof useWebsiteDataState>;
export type WebsiteDataState = UnwrapRef<WebsiteDataStateRefs>;
