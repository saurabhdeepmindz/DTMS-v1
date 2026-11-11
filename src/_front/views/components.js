/*__WW_PAGE_COMPONENT_IMPORTS_START__*/

// eslint-disable-next-line no-undef
__WW_ELEMENT_IMPORTS__;

// eslint-disable-next-line no-undef
__WW_SECTION_IMPORTS__;

/*__WW_PAGE_COMPONENT_IMPORTS_END__*/

import { registerSsrPageComponents } from '@/_front/rendering/ssrPageComponents';

let isRegistered = false;

export default async function registerPageComponents(app) {
    if (isRegistered) return;

    if (import.meta.env.SSR) {
        await registerSsrPageComponents(
            app,
            // eslint-disable-next-line no-undef
            __WW_SSR_PAGE_COMPONENT_DESCRIPTORS__
        );
    } else {
        // eslint-disable-next-line no-undef
        __WW_ELEMENTS_IN_VUE__;

        // eslint-disable-next-line no-undef
        __WW_SECTIONS_IN_VUE__;
    }

    isRegistered = true;
}
