import type { FrontStateRefs } from './state';
import type { LinkPopup } from './state';

 
/** Private hydration and history writers. Native consumers use the store's commands. */

export function useFrontWriters({
    stateRefs,
}: {
    stateRefs: Pick<
        FrontStateRefs,
        'showPageLoadProgress' | 'theme' | 'lang' | 'isScreenSizeActive' | 'activeLinkPopup'
    >;
}) {
    const writers = {
        showPageLoadProgress(showPageLoadProgress: boolean): void {
            stateRefs.showPageLoadProgress.value = showPageLoadProgress;
        },
        setTheme(theme: string): void {
            stateRefs.theme.value = theme;
        },
        /*=============================================m_ÔÔ_m=============================================\
        LANG
    \================================================================================================*/
        setLang(newLang: string): void {
             stateRefs.lang.value = newLang;
        },
        /*=============================================m_ÔÔ_m=============================================\
        SCREEN SIZE
    \================================================================================================*/
        setIsScreenSizeActive({ screenSize, isActive }: { screenSize: string; isActive: boolean }): void {
            stateRefs.isScreenSizeActive.value[screenSize] = !!isActive;

         },
        setActiveLinkPopup(options: LinkPopup | null): void {
            const { content, background, sectionId } = options || {};
            stateRefs.activeLinkPopup.value = options ? { content, background, sectionId } : null;
        },
    };
    return writers;
}

export type FrontWriters = ReturnType<typeof useFrontWriters>;
