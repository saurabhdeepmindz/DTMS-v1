import emitter from 'tiny-emitter/instance';
import services from './services/index.js';

 /* wwFront:start */
// eslint-disable-next-line no-undef
;
// The token maps of the newer types: `typeof` keeps an empty map when a publisher older than this code leaves the
// placeholder in place.
// eslint-disable-next-line no-undef
const LIBRARY_RADIUS = typeof {"fbe9eed5-bbf4-4018-beb9-ff75f91719bb":"6px","4a95903e-4140-45bc-ad6a-50d2c6a2dfa3":"14px","400097e4-8919-4b38-bf98-bc0d2ff6d8b3":"999px","e728740a-0437-423d-b3e8-49d3e1a7eca0":"10px"} === 'undefined' ? {} : {"fbe9eed5-bbf4-4018-beb9-ff75f91719bb":"6px","4a95903e-4140-45bc-ad6a-50d2c6a2dfa3":"14px","400097e4-8919-4b38-bf98-bc0d2ff6d8b3":"999px","e728740a-0437-423d-b3e8-49d3e1a7eca0":"10px"};
// eslint-disable-next-line no-undef
const LIBRARY_SHADOWS = typeof {"b4be0c77-a029-4a8e-9dc1-64621642dc5f":"0 2px 8px #0F18290A, 0 1px 2px #0F182908","69f1d9bd-44b8-42d4-a6db-c3052456049d":"0 10px 28px #0F182914, 0 2px 6px #0F18290A"} === 'undefined' ? {} : {"b4be0c77-a029-4a8e-9dc1-64621642dc5f":"0 2px 8px #0F18290A, 0 1px 2px #0F182908","69f1d9bd-44b8-42d4-a6db-c3052456049d":"0 10px 28px #0F182914, 0 2px 6px #0F18290A"};
// eslint-disable-next-line no-undef
const LIBRARY_BORDERS = typeof {"4f259564-dba4-41d6-b0d2-203e6391c603":"1px solid var(--beb6bfc1-2d6b-4aa8-a582-270be519f430, #E4E0DA)","d5880618-ca0f-47ec-9489-94e6bec913c6":"1px solid var(--68d9054b-6060-43d2-aaf8-f9f0aee656b9, #B91C1C)","6f9ab92b-0fd8-4435-a8d4-308549b6efe6":"1px solid var(--1d931ad5-9f57-4a65-820a-b4a30db7b448, #C8C3BB)","c6489106-9d2a-4b50-b0a0-b0fa59d1f0e9":"1px solid var(--bdd0fa57-39a7-4e49-a92d-eec6e095eace, #E8521A)","928cacfb-3bd8-4081-a880-04cc40f1eb9a":"1px solid var(--fe170f4f-860a-477f-970b-e7769acfc9d6, #0E6E5A)","2170466a-37d7-427d-9639-c6c509ba7241":"1px solid var(--c35ad809-80a2-49d4-8f94-0c85659b6ff1, #854F0B)","1cffa78f-69e0-4f7c-a83e-8c6dd061ab92":"1px solid var(--f49d17b4-cb91-4035-a1ec-b3430d048ad6, #4C3AAD)"} === 'undefined' ? {} : {"4f259564-dba4-41d6-b0d2-203e6391c603":"1px solid var(--beb6bfc1-2d6b-4aa8-a582-270be519f430, #E4E0DA)","d5880618-ca0f-47ec-9489-94e6bec913c6":"1px solid var(--68d9054b-6060-43d2-aaf8-f9f0aee656b9, #B91C1C)","6f9ab92b-0fd8-4435-a8d4-308549b6efe6":"1px solid var(--1d931ad5-9f57-4a65-820a-b4a30db7b448, #C8C3BB)","c6489106-9d2a-4b50-b0a0-b0fa59d1f0e9":"1px solid var(--bdd0fa57-39a7-4e49-a92d-eec6e095eace, #E8521A)","928cacfb-3bd8-4081-a880-04cc40f1eb9a":"1px solid var(--fe170f4f-860a-477f-970b-e7769acfc9d6, #0E6E5A)","2170466a-37d7-427d-9639-c6c509ba7241":"1px solid var(--c35ad809-80a2-49d4-8f94-0c85659b6ff1, #854F0B)","1cffa78f-69e0-4f7c-a83e-8c6dd061ab92":"1px solid var(--f49d17b4-cb91-4035-a1ec-b3430d048ad6, #4C3AAD)"};
/* wwFront:end */

import { computed, reactive } from 'vue';

import { getRuntimeEnvironment } from '@/helpers/frontEnv.js';

import { createEnvironmentVariablesContext } from './services/environmentVariables';
import { createStoreRegistry } from '@/pinia/storeRegistry';
import { disposePinia } from 'pinia';

let runtimeActivationError;

export default {
    /** @type {import('@/pinia/storeRegistry').StoreRegistry} */
    store: undefined,
    /** @internal Install native store references for this application instance. */
    initializeStores(pinia) {
        this.$pinia = pinia;
        this.store = createStoreRegistry(pinia);
    },
    /** @internal Dispose the runtime after its pending operations have completed. */
    disposeStores() {
         if (this.$pinia) disposePinia(this.$pinia);
        this.$pinia = undefined;
        this.store = undefined;
    },
    ...services,
     $on(event, fn) {
        emitter.on(event, fn);
    },
    $once(event, fn) {
        emitter.once(event, fn);
    },
    $emit(event, ...args) {
        if (!event) {
            return;
        }
        emitter.emit(event, ...args);
    },
    $off(event, fn) {
        emitter.off(event, fn);
    },
     front: {},
    $focus: null,
    env: process.env.NODE_ENV,
    runtimeActivated: false,
    async initFront({ router, store, staticRendering = false }) {
 
        this.front.router = router;
        /* wwFront:start */
        this.$store = store;
        /* wwFront:end */

        //Init services
        this.wwLog.init();

 
        await this.wwWebsiteData.init();
        this.wwLang.init(router);

        /* wwFront:start */
        // eslint-disable-next-line no-undef
        ;
        /* wwFront:end */

 
        if (!staticRendering) this.activateRuntime();
    },
    activateRuntime() {
        if (this.runtimeActivated) return;
        if (runtimeActivationError) throw runtimeActivationError;

        try {
            void this.wwPluginHelper.activatePlugins();
            services.scrollStore.start();
            services.keyboardEventStore.start();
            services.pwaStore.start();
            this.runtimeActivated = true;
        } catch (error) {
            runtimeActivationError = error;
            throw error;
        }
    },
     // TODO: Verify with Alexis, still uses wwImageMultiLang
    /** @PUBLIC_API The active responsive breakpoint name. */
    get currentBreakpoint() {
        return wwLib.store.front.activeScreenSize;
    },
    /** @PUBLIC_API Reactive breakpoint definitions. */
    get breakpoints() {
        return wwLib.store.front.screenSizes;
    },
    /** @PUBLIC_API Historical method retained for distributed components. */
    getCurrentBreakpoint() {
        return wwLib.currentBreakpoint;
    },
    /** @PUBLIC_API Reactive definitions of the project's responsive breakpoints. */
    getBreakpoints() {
        return wwLib.breakpoints;
    },
    getResponsiveStyleProp({ style, uid, states = [], prop }) {
        if (!style && uid) {
            const wwObject = wwLib.store.websiteData.wwObjects[uid];
            if (!wwObject) return '';
            style = (wwObject._state || {}).style || {};
        }

        const screenSizes = wwLib.store.front.screenSizes;
        const screenSize = wwLib.store.front.activeScreenSize;

        let value = '';

        for (const media in screenSizes) {
            if (style[media] && typeof style[media][prop] !== 'undefined') {
                value = style[media][prop];
            }
            if (media === screenSize) {
                break;
            }
        }
        for (const state of states) {
            for (const media in screenSizes) {
                if (style[`${state}_${media}`] && style[`${state}_${media}`][prop]) {
                    value = style[`${state}_${media}`][prop];
                }
                if (media === screenSize) {
                    break;
                }
            }
        }

        return value;
    },
    globalContext: reactive({
        auth: computed(() => {
            const backAuthStore = wwLib.store.backAuth;
            return {
                user: backAuthStore.user,
                session: backAuthStore.session,
                isAuthenticated: backAuthStore.isAuthenticated,
            };
        }),
        env: computed(() => {
            const envVariablesStore = wwLib.store.envVariables;
            let env = wwLib.getEnvironment();
            if (env === 'preview') env = 'production';
            return createEnvironmentVariablesContext(Object.values(envVariablesStore.values), env);
        }),
        tableViews: computed(() => {
            const backTableViewsStore = wwLib.store.backTableViews;
            return backTableViewsStore?.data;
        }),
        page: computed(() => {
            const page = wwLib.store.websiteData.page;
            if (!page) return {};
            else if (!page.cmsDataSetPath) return { ...pageSanitizer(page) };
            return { ...pageSanitizer(page), data: wwLib.store.data.pageCollectionData };
        }),
        pageParameters: computed(() => {
            const pageParameters = Object.values(wwLib.store.data.pageParameterVariables);
            const pageParametersValueMap = {};
            for (const pageParameter of pageParameters) pageParametersValueMap[pageParameter.id] = pageParameter.value;
            return pageParametersValueMap;
        }),
        pages: computed(() => {
            const pages = wwLib.store.websiteData.pages;
            const pagesValueMap = {};
            for (const page of pages) pagesValueMap[page.id] = pageSanitizer(page);
            return pagesValueMap;
        }),
        colors: computed(() => {
            const theme = wwLib.store.front.resolvedTheme;
             /* wwFront:start */
            // eslint-disable-next-line no-unreachable, no-undef
            return theme === 'dark' ? {"30ece32b-7577-4e0a-bcee-d2bb95f15520":"#A1A1AA","a07edec1-45d3-4ab5-b5c2-68c92f79ca6f":"#FAFAFA","2ff74390-19a6-4722-8e3b-57372656915f":"#09090B","7c80aa09-6c05-4c34-8a44-864c208bd326":"#18181B","0770f1ef-8f56-47cb-be5e-d539138a2937":"#27272A","33fc0a46-dd07-406e-8a3c-2571cdb61e6d":"#FAFAFA","bc16873d-5b54-43dd-96ba-554913fdcb73":"#E4E4E7","71c3a298-f0f4-4829-b051-3f1067bd1469":"#1B2B4B","bdd0fa57-39a7-4e49-a92d-eec6e095eace":"#FF6B35","07f73e18-cee1-4b3d-ab86-170b16d238e5":"#1E183A","5a949a86-4869-4e17-8c3f-8f58bc85f459":"#131D31","75d38910-867d-499d-9e10-004eea144fd3":"#CBD5E1","fe170f4f-860a-477f-970b-e7769acfc9d6":"#2DD4BF","9a2636e1-07c0-4cdf-9f1d-31c5e50b5a9b":"#0D2E28","0e0cf890-0c24-4ccd-995c-851ec9d2fad6":"#112239","68d9054b-6060-43d2-aaf8-f9f0aee656b9":"#F87171","beb6bfc1-2d6b-4aa8-a582-270be519f430":"#243558","be880899-3b68-47eb-83e7-84c9d7674aa1":"#64748B","f81a34d5-77d4-4a74-8f8a-7bcbe4e39eee":"#2E2008","f3774a91-7c10-4c1e-b5df-89dd594e2dbe":"#0B111E","eb717c46-f099-4708-ab4e-436436cf0c99":"#94A3B8","848ddbad-c0d4-4d52-a718-5b8993f4047a":"#0F1829","43549ba2-130c-4336-9704-3ae607ede756":"#243558","eefe9d15-8611-4677-aece-f5709851ed25":"#2D1810","0804ae58-bbf3-42e0-b840-e7fb68590c37":"#60A5FA","f49d17b4-cb91-4035-a1ec-b3430d048ad6":"#A78BFA","c35ad809-80a2-49d4-8f94-0c85659b6ff1":"#FBBF24","844326e7-e935-423d-b916-df2a2abd9eb8":"#311111","5006ab6d-23f2-4874-b3a0-93e6ffffa49f":"#19253E","1d931ad5-9f57-4a65-820a-b4a30db7b448":"#334873","8713aa4a-14ae-42b9-89f8-0d456bbc822b":"#F8FAFC"} : {"30ece32b-7577-4e0a-bcee-d2bb95f15520":"#71717A","a07edec1-45d3-4ab5-b5c2-68c92f79ca6f":"#18181B","2ff74390-19a6-4722-8e3b-57372656915f":"#FFFFFF","7c80aa09-6c05-4c34-8a44-864c208bd326":"#FAFAFA","0770f1ef-8f56-47cb-be5e-d539138a2937":"#E4E4E7","33fc0a46-dd07-406e-8a3c-2571cdb61e6d":"#09090B","bc16873d-5b54-43dd-96ba-554913fdcb73":"#3F3F46","71c3a298-f0f4-4829-b051-3f1067bd1469":"#1B2B4B","bdd0fa57-39a7-4e49-a92d-eec6e095eace":"#E8521A","07f73e18-cee1-4b3d-ab86-170b16d238e5":"#EEEBFA","5a949a86-4869-4e17-8c3f-8f58bc85f459":"#FFFFFF","75d38910-867d-499d-9e10-004eea144fd3":"#3D3A35","fe170f4f-860a-477f-970b-e7769acfc9d6":"#0E6E5A","9a2636e1-07c0-4cdf-9f1d-31c5e50b5a9b":"#E4F5F0","0e0cf890-0c24-4ccd-995c-851ec9d2fad6":"#EBF2FC","68d9054b-6060-43d2-aaf8-f9f0aee656b9":"#B91C1C","beb6bfc1-2d6b-4aa8-a582-270be519f430":"#E4E0DA","be880899-3b68-47eb-83e7-84c9d7674aa1":"#B0AAA2","f81a34d5-77d4-4a74-8f8a-7bcbe4e39eee":"#FEF5E7","f3774a91-7c10-4c1e-b5df-89dd594e2dbe":"#F4F2EF","eb717c46-f099-4708-ab4e-436436cf0c99":"#7A746C","848ddbad-c0d4-4d52-a718-5b8993f4047a":"#0F1829","43549ba2-130c-4336-9704-3ae607ede756":"#243558","eefe9d15-8611-4677-aece-f5709851ed25":"#FEF0EB","0804ae58-bbf3-42e0-b840-e7fb68590c37":"#1A4F8C","f49d17b4-cb91-4035-a1ec-b3430d048ad6":"#4C3AAD","c35ad809-80a2-49d4-8f94-0c85659b6ff1":"#854F0B","844326e7-e935-423d-b916-df2a2abd9eb8":"#FEF2F2","5006ab6d-23f2-4874-b3a0-93e6ffffa49f":"#ECE9E3","1d931ad5-9f57-4a65-820a-b4a30db7b448":"#C8C3BB","8713aa4a-14ae-42b9-89f8-0d456bbc822b":"#141210"};
            /* wwFront:end */
        }),
        spacings:
         /* wwFront:start */
        // eslint-disable-next-line no-unreachable, no-undef
        {"eaa70d27-ea40-4305-8371-c990bc8c9cb2":"32px","89a07efc-7f56-486e-8b79-da9ba3a64c4a":"10px","097e82f0-aec6-4ccd-b8f9-391d4c0774c3":"9999px","2a5777a3-5a91-42ae-a2f1-994832337879":"4px","d8c360eb-14c4-4d88-82be-5b1a09bb375a":"24px","5bcd8732-8270-4143-a328-a03c3bf36ca7":"16px","72fea8e4-c5ca-4bfe-accd-90936bb9dd5a":"6px","5f4045a1-1392-40ac-a1bd-7f89ebf767c0":"12px","0a6628ac-ff66-4071-95c5-45e4a28d98db":"40px"},
        /* wwFront:end */
        typographies:
         /* wwFront:start */
        // eslint-disable-next-line no-unreachable, no-undef
        {"9ff374c6-6f49-4f3b-9a94-d0363d787283":"700 32px/1.25 var(--ww-default-font-family, sans-serif)","8b6c8eb4-19b2-40c9-b706-2b2abf931690":"400 14px/1.5 var(--ww-default-font-family, sans-serif)","244b33bc-d183-43ef-ba6f-7cd36de1675d":"600 12px/1.4 var(--ww-default-font-family, sans-serif)","ec4c7a1a-2c75-415d-9931-005b3cf20497":"400 28px/1.1 'DM Serif Display', Georgia, serif","4d70d3e1-b468-463c-bffd-5ad5257a5784":"400 13px/1.55 'DM Sans', sans-serif","3b7e7be2-95c6-4b54-b860-eed67fda4356":"700 15px/1.3 'DM Sans', sans-serif","303a62d9-0d25-46d9-b9ea-8e39ded45898":"400 32px/1.15 'DM Serif Display', Georgia, serif","dbe30109-6105-4a89-89de-4048ec3bddb7":"400 22px/1.15 'DM Serif Display', Georgia, serif","56769e4f-f618-4326-8b78-9c986e4a667d":"600 13px/1.35 'DM Sans', sans-serif","341a66a6-0eec-4137-9e1a-c696858f1a8d":"500 11px/1.4 'DM Sans', sans-serif","39f071f7-4d6c-4787-8dd9-b561e2d9c04f":"600 10px/1.2 'JetBrains Mono', monospace","b7ed17a1-bc04-4f60-a708-df6579a046a5":"500 11px/1.4 'JetBrains Mono', monospace","b62c65b7-2199-4d59-b9a5-229804084377":"600 12px/1.3 'JetBrains Mono', monospace"},
        /* wwFront:end */
        // The newer token types (see LIBRARY_RADIUS). Shadows and borders keep their var(--color): the CSS resolves it.
        radius:
         /* wwFront:start */
        LIBRARY_RADIUS,
        /* wwFront:end */
        shadows:
         /* wwFront:start */
        LIBRARY_SHADOWS,
        /* wwFront:end */
        borders:
         /* wwFront:start */
        LIBRARY_BORDERS,
        /* wwFront:end */
        browser: computed(() => {
            const router = wwLib.manager ? wwLib.getEditorRouter() : wwLib.getFrontRouter();
            const currentRoute = router.currentRoute.value;
            let currentQueries = currentRoute.query;
             return {
                url: window.location.origin + currentRoute.fullPath,
                path: currentRoute.path,
                // verify if auth plugin
                 /* wwFront:start */
                // eslint-disable-next-line no-dupe-keys
                source: currentQueries._source,
                /* wwFront:end */
                query: currentQueries,
                domain: window.location.hostname,
                baseUrl: window.location.origin,
                breakpoint: wwLib.store.front.activeScreenSize,
                environment: wwLib.getEnvironment(),
                theme: wwLib.store.front.resolvedTheme,
            };
        }),
        pwa: services.pwaStore.pwa,
        screen: services.scrollStore.screen,
        componentPositionInfo: services.scrollStore.componentPositionInfo,
    }),

    pageData: computed(() => {
        const lang = wwLib.store.front.lang;
        const cmsDataSetPath = wwLib.store.websiteData.page.cmsDataSetPath;
        if (!cmsDataSetPath) {
            return { lang };
        }

        return { lang, data: wwLib.store.data.pageCollectionData };
    }),

    getEnvironment() {
        return getRuntimeEnvironment();
    },

    useBaseTag() {
        return (
            wwLib.getEnvironment() === 'production' &&
            window.wwg_designInfo.baseTag &&
            window.wwg_designInfo.baseTag.href
        );
    },

    getBaseTag() {
        let baseTag = window.wwg_designInfo.baseTag?.href || '';
        if (!baseTag.startsWith('/')) {
            baseTag = '/' + baseTag;
        }
        if (!baseTag.endsWith('/')) {
            baseTag += '/';
        }
        return baseTag;
    },

    /**
     * @PUBLIC_API
     */
    getFrontWindow() {
        // This is called for every compiled CSS declaration and Vue timing measurement.
        // In the canvas document there is no nested editor iframe: a class selector would
        // scan the entire rendered page on every call. The editor iframe has a fixed ID.
        return document.getElementById('ww-manager-iframe')?.contentWindow || window;
    },

    /**
     * @PUBLIC_API
     */
    getFrontDocument() {
        return this.getFrontWindow().document;
    },

    /**
     * @PUBLIC_API
     */
    getFrontRouter() {
        return this.front.router;
    },

    /**
     * @PUBLIC_API
     */
    getEditorWindow() {
         // eslint-disable-next-line no-unreachable
        return null;
    },

    /**
     * @PUBLIC_API
     */
    getEditorDocument() {
         // eslint-disable-next-line no-unreachable
        return null;
    },

    /**
     * @PUBLIC_API
     */
    getEditorRouter() {
        return this.editor.router;
    },

    /**
     * @PUBLIC_API
     * @DEPRECATED wwLib.wwApp.goTo
     */
    goTo(...args) {
        wwLib.wwLog.warn('wwLib.goTo is DEPRECATED, use wwLib.wwApp.goTo instead');
        wwLib.wwApp.goTo(...args);
    },

    /**
     * @PUBLIC_API
     * @DEPRECATED wwLib.wwUtils.getStyleFromToken
     */
    getStyleFromToken(...args) {
        // wwLib.wwLog.warn('wwLib.getStyleFromToken is DEPRECATED, use wwLib.wwUtils.getStyleFromToken instead');
        return wwLib.wwUtils.getStyleFromToken(...args);
    },

    /**
     * @PUBLIC_API
     * @DEPRECATED wwLib.wwUtils.getTypoFromToken
     */
    getTypoFromToken(...args) {
        // wwLib.wwLog.warn('wwLib.getTypoFromToken is DEPRECATED, use wwLib.wwUtils.getTypoFromToken instead');
        return wwLib.wwUtils.getTypoFromToken(...args);
    },

    /**
     * @PUBLIC_API
     * @DEPRECATED
     */
    element(value) {
        wwLib.wwLog.warn('wwLib.element is DEPRECATED');
        if (typeof value === 'object') {
            return { isWwObject: true, ...value };
        } else {
            return { isWwObject: true, type: value };
        }
    },

    /**
     * @PUBLIC_API
     * @DEPRECATED wwLib.wwUtils.resolveObjectPropertyPath
     */
    resolveObjectPropertyPath(...args) {
        // wwLib.wwLog.warn(
        //     'wwLib.resolveObjectPropertyPath is DEPRECATED, use wwLib.wwUtils.resolveObjectPropertyPath instead'
        // );
        return wwLib.wwUtils.resolveObjectPropertyPath(...args);
    },

    /**
     * @PUBLIC_API
     * @DEPRECATED wwLib.wwWorkflow.executeGlobal
     */
    async executeWorkflow(...args) {
        wwLib.wwLog.warn('wwLib.executeWorkflow is DEPRECATED, use wwLib.wwWorkflow.executeGlobal instead');
        return wwLib.wwWorkflow.executeGlobal(...args);
    },

    /**
     * @PUBLIC_API
     * @EDITOR
     * @DEPRECATED wwLib.wwEditor.findParentUidByFlag
     */
    findParentUidByFlag(...args) {
        wwLib.wwLog.warn('wwLib.wwEditor.findParentUidByFlag is DEPRECATED, use wwLib.findParentUidByFlag instead');
        return wwLib.wwEditor.findParentUidByFlag(...args);
    },

    /**
     * @PUBLIC_API
     * @EDITOR
     * @DEPRECATED wwLib.wwEditor.selectParentByFlag
     */
    selectParentByFlag(...args) {
        wwLib.wwLog.warn('wwLib.wwEditor.selectParentByFlag is DEPRECATED, use wwLib.selectParentByFlag instead');
        return wwLib.wwEditor.selectParentByFlag(...args);
    },

    /**
     * @PUBLIC_API
     * @DEPRECATED wwLib.wwElement.useCreate
     */
    useCreateElement() {
        wwLib.wwLog.warn('wwLib.useCreateElement is DEPRECATED, use wwLib.wwElement.useCreate instead');
        return this.wwElement.useCreate();
    },

    /**
     * @PUBLIC_API
     * @DEPRECATED wwLib.wwElement.useLayoutStyle
     */
    useLayoutStyle() {
        wwLib.wwLog.warn('wwLib.useLayoutStyle is DEPRECATED, use wwLib.wwElement.useLayoutStyle instead');
        return wwLib.wwElement.useLayoutStyle();
    },

    /**
     * @PUBLIC_API
     */
    useIcons() {
        const store = wwLib.store.icons;
        return {
            getIcon: store.getIcon,
        };
    },
};

 
function pageSanitizer(page) {
    const keysToInclude = [
        'id',
        'name',
        'folder',
        'metaImage',
        'pageLoaded',
        'paths',
        'langs',
        'meta',
        'title',
        'sections',
        'pageUserGroups',
    ];

    const _page = {};
    keysToInclude.forEach(key => {
        _page[key] = page[key];
    });

    _page.meta && delete _page.meta.__typename;
    for (const section of _page.sections || []) {
        delete section.__typename;
    }

    const lang = wwLib.store.front.lang;
    if (_page.paths) _page.path = _page.paths[lang] || _page.paths.default;
    else _page.path = null;

    _page.lang = lang;

    return _page;
}
