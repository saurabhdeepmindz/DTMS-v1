import type { FrontWriters } from './writers';

/** Commands are the native Pinia actions; this composable receives their private dependencies. */
export function useFrontCommands({ writers }: { writers: FrontWriters }) {
    const commands = {
        setPageLoadProgress: writers.showPageLoadProgress,
        setTheme(theme: string): void {
            writers.setTheme(theme);

            let themeItemName = 'ww-app-theme';
             if (window.localStorage) window.localStorage.setItem(themeItemName, theme);
        },
        /*=============================================m_ÔÔ_m=============================================\
        LANG
    \================================================================================================*/
        setLang: writers.setLang,
        /*=============================================m_ÔÔ_m=============================================\
        SCREEN SIZE
    \================================================================================================*/
        setIsScreenSizeActive: writers.setIsScreenSizeActive,
        setActiveLinkPopup: writers.setActiveLinkPopup,
        closeActiveLinkPopup(): void {
            writers.setActiveLinkPopup(null);
        },
    };
    return commands;
}

export type FrontCommands = ReturnType<typeof useFrontCommands>;
