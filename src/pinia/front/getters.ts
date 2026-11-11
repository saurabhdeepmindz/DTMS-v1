import { computed } from 'vue';

import type { FrontStateRefs } from './state';

/** Derive values from this application's existing state refs. */
export function useFrontGetters(refs: FrontStateRefs) {
    const resolvedTheme = computed((): string | undefined => {
        if (refs.theme.value === undefined) return wwLib.store.websiteData.design?.info?.defaultTheme;
        return refs.theme.value;
    });
    const activeScreenSize = computed((): string => {
        const activeScreenSizes = Object.keys(refs.isScreenSizeActive.value)
            .filter(screenSize => refs.isScreenSizeActive.value[screenSize])
            .map(screenSize => {
                return { name: screenSize, order: refs.screenSizes.value[screenSize].order };
            });

        activeScreenSizes.sort(({ order: orderA }, { order: orderB }) => {
            return orderB - orderA;
        });

        return activeScreenSizes.length ? activeScreenSizes[0].name : 'default';
    });

    return {
        resolvedTheme,
        activeScreenSize,
    };
}

export type FrontGetters = ReturnType<typeof useFrontGetters>;
