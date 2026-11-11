import { ref, type UnwrapRef } from 'vue';
import type { Registry } from '../entities';
export interface Breakpoint {
    order: number;
    label: Record<string, string>;
    breakPoint: number | null;
    icon: string;
    query: string | null;
    defaultWidth: number;
    defaultHeight: number;
}
export interface LinkPopup {
    content: unknown;
    background?: unknown;
    sectionId?: string;
}

export function useFrontState() {
    return {
        showPageLoadProgress: ref(false),
        /*=============================================m_ÔÔ_m=============================================\
        LANG
    \================================================================================================*/
        lang: ref('en'),
        /*=============================================m_ÔÔ_m=============================================\
        SCREEN SIZE
    \================================================================================================*/
        screenSize: ref<string | null>(null),

        screenSizes: ref<Registry<Breakpoint>>({
            default: {
                order: 0,
                label: {
                    en: 'Desktop',
                    fr: 'Ordinateur',
                },
                breakPoint: null,
                icon: '16/desktop',
                query: null,
                defaultWidth: 1100,
                defaultHeight: (1100 * 9) / 16,
            },
            tablet: {
                order: 1,
                label: {
                    en: 'Tablet',
                    fr: 'Tablette',
                },
                breakPoint: 991,
                icon: '16/tablet',
                query: 'max-width: 991px',
                defaultWidth: 770,
                defaultHeight: (770 * 14) / 9,
            },
            mobile: {
                order: 2,
                label: {
                    en: 'Mobile',
                    fr: 'Mobile',
                },
                breakPoint: 767,
                icon: '16/mobile',
                query: 'max-width: 767px',
                defaultWidth: 400,
                defaultHeight: (400 * 13) / 9,
            },
        }),
        isScreenSizeActive: ref<Registry<boolean>>({}),
        theme: ref<string | undefined>(
            typeof window === 'undefined' ? undefined : window.localStorage?.getItem('ww-app-theme') || undefined
        ),
        activeLinkPopup: ref<LinkPopup | null>(null),
        elementStates: ref<Registry<unknown>>({}),
    };
}

export type FrontStateRefs = ReturnType<typeof useFrontState>;
export type FrontState = UnwrapRef<FrontStateRefs>;
