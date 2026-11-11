import { createApp, createSSRApp, nextTick } from 'vue';
import { setActivePinia } from 'pinia';
import axios from 'axios';
import { VueCookieNext } from 'vue-cookie-next';
import { isEqual, isEmpty, cloneDeep, get, set, merge } from 'lodash-es';
import '@/assets/css/common.css';

 
/* wwFront:start */
import { createHead } from '@unhead/vue/client';
import wwServerClient from '@/_common/helpers/code/serverClient.js';
/* wwFront:end */

import App from '@/_front/App.vue';
import router from '@/_front/router.js';

let store;
let pinia;
let currentRenderMode = 'runtime';
let isServerRendering = false;
let isHydrating = false;
let isStaticRendering = false;
let browserRuntimeActivationError;

/* wwFront:start */

import wwLibImport from '@/wwLib';
import { createPinia } from 'pinia';
import { createCompatibilityStore } from '@/compat';
import { initializeCurrentRouteRuntime, startCurrentRouteDataInitialization } from '@/_front/router.js';
import { activateHydratedRuntime } from '@/_front/rendering/hydrationRuntime.ts';
import { releaseClientIslandHydrationState } from '@/_front/rendering/clientIslandContext';
import { deactivateStaticRendering } from '@/_front/rendering/staticRenderingContext';
import { isServerRenderMode, isStaticRenderMode, renderMode } from '@/_front/rendering/renderMode';
import { activateRuntimeLifecycle, discardRuntimeLifecycle } from '@/_front/rendering/runtimeLifecycleScheduler';
import { restoreInitialEnvironment } from '@/_front/rendering/prerenderBootstrap';
import { removeStyleCompilerPrerenderRuntime } from '@/_front/rendering/styleCompilerPrerenderRuntime';

currentRenderMode = renderMode;
isServerRendering = isServerRenderMode(renderMode);
isHydrating = renderMode === 'hydrate';
isStaticRendering = isStaticRenderMode(renderMode);

if (!isServerRendering && window.localStorage?.getItem('ww-app-theme') === 'dark')
    document.documentElement.classList.add('ww-app-theme-dark');
else if (!isServerRendering && window.localStorage?.getItem('ww-app-theme') === 'light')
    document.documentElement.classList.remove('ww-app-theme-dark');

pinia = createPinia();
setActivePinia(pinia);
// Object.assign avoids a JS-inferred global declaration overriding the typed WwLib contract.
Object.assign(globalThis, { wwLib: wwLibImport });
wwLibImport.initializeStores(pinia);
store = createCompatibilityStore();
/* wwFront:end */

 
import wwElements from '@/_front/components/index.js';
import { addMediaQueriesListener } from '../helpers/mediaQueriesListener.js';
import globalServices from '@/_common/plugins/globalServices.js';

 
import '@/assets/css';

globalThis._ = {
    isEqual,
    isEmpty,
    cloneDeep,
    get,
    set,
    merge,
};
globalThis.axios = axios.create({});

const hooksStore = wwLib.store.hooks;
hooksStore.registerIntegrationHooks();

 /* wwFront:start */
globalThis.wwServerClient = wwServerClient;
/* wwFront:end */

export const app = currentRenderMode === 'runtime' ? createApp(App) : createSSRApp(App);
export { pinia, router, store };

let setupPromise;
let browserRuntimeActivated = false;

export function setupApp({ url } = {}) {
    if (setupPromise) return setupPromise;

    setupPromise = (async () => {
        window.vm = app;
        app.use(pinia);
        app.use(store);
        app.use(VueCookieNext);
        app.use(wwElements);
        app.use(globalServices);
        app.config.unwrapInjectedRef = true;
        /* wwFront:start */
        app.use(createHead());
        /* wwFront:end */

 
        await wwLib.initFront({
            store,
            router,
            staticRendering: isStaticRendering,
        });

        /* wwFront:start */
        if (currentRenderMode === 'runtime') activateBrowserRuntime();
        /* wwFront:end */
 
        app.use(router);

        if (isServerRendering && url) {
            await router.push(url);
        }

        await router.isReady();

        return { app, pinia, router, store };
    })();

    return setupPromise;
}

export async function mountApp() {
    try {
        await setupApp();
    } catch (error) {
        if (isHydrating) restoreInitialEnvironment();
        throw error;
    }

    const element = document.getElementById('app');
    if (isHydrating) {
        /* wwFront:start */
        const hydration = await activateHydratedRuntime({
            blockRuntimeInteractions: () => blockHydrationInteractions(element),
            releaseRuntimeInteractions: () => releaseHydrationInteractions(element),
            hydrateApp: () => mountHydratedApp(element),
            initializeRouteRuntime: initializeCurrentRouteRuntime,
            activateBrowserRuntime,
            releaseStaticProjection,
            activateRuntimeLifecycle,
            discardRuntimeLifecycle,
            startRouteDataInitialization: startCurrentRouteDataInitialization,
            reportFailure: reportHydrationRuntimeFailure,
        });
        if (hydration.status !== 'ready') return { app, pinia, router, store };
        /* wwFront:end */
    } else app.mount(element);

    /* wwFront:start */
    wwLib.scrollStore.setValues();
    /* wwFront:end */

    wwLib.$emit('wwLib:isMounted');
    wwLib.isMounted = true;

    return { app, pinia, router, store };
}

if (!isServerRendering) {
    mountApp();
}

/* wwFront:start */
/**
 * Hydrates the pre-rendered application while surfacing Vue hydration failures
 * with a stable prefix and the affected URL. Vue performs hydration synchronously
 * during `mount()`, so the console override is restored immediately afterwards.
 */
function mountHydratedApp(element) {
    const originalError = console.error;
    let mismatchReported = false;

    console.error = (...values) => {
        originalError(...values);
        if (mismatchReported || !values.some(value => /hydrat|mismatch/i.test(`${value}`))) return;

        mismatchReported = true;
        originalError('[weweb-hydration] Hydration mismatch detected.', {
            url: window.location.href,
        });
    };

    try {
        return app.mount(element);
    } catch (error) {
        originalError('[weweb-hydration] Hydration failed.', {
            url: window.location.href,
            error,
        });
        throw error;
    } finally {
        restoreInitialEnvironment();
        console.error = originalError;
    }
}

const HYDRATION_RUNTIME_FAILURE_MESSAGES = {
    'runtime-initialization': 'Runtime initialization failed; preserving the static projection.',
    'browser-runtime-activation': 'Browser runtime activation failed; preserving the static projection.',
    'lifecycle-activation': 'Runtime lifecycle activation failed after hydration.',
    'route-data-initialization': 'Route data initialization failed after hydration.',
};

function reportHydrationRuntimeFailure(phase, error) {
    console.error(`[weweb-hydration] ${HYDRATION_RUNTIME_FAILURE_MESSAGES[phase]}`, {
        url: window.location.href,
        error,
    });
}

async function releaseStaticProjection() {
    deactivateStaticRendering();
    await nextTick();
    removeStyleCompilerPrerenderRuntime();
    releaseClientIslandHydrationState();
}

function blockHydrationInteractions(element) {
    element.setAttribute('inert', '');
}

function releaseHydrationInteractions(element) {
    element.removeAttribute('inert');
}

/**
 * Starts browser-only services once. During hydration this runs only after Vue has
 * consumed the static projection and the route runtime prerequisites are ready.
 */
function activateBrowserRuntime() {
    if (browserRuntimeActivated || isServerRendering) return;
    if (browserRuntimeActivationError) throw browserRuntimeActivationError;

    try {
        wwLib.activateRuntime();
        addMediaQueriesListener(wwLib.store.front.screenSizes, (screenSize, isActive) => {
            wwLib.store.front.setIsScreenSizeActive({ screenSize, isActive });
        });
        registerServiceWorker();

        wwLib.getFrontWindow().addEventListener('beforeinstallprompt', event => {
            event.preventDefault();
            wwLib.installPwaPrompt = event;
        });

        browserRuntimeActivated = true;
    } catch (error) {
        browserRuntimeActivationError = error;
        throw error;
    }
}

function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;

    if (window.wwg_disableManifest) {
        navigator.serviceWorker.getRegistrations().then(registrations => {
            for (const registration of registrations) {
                registration.unregister();
            }
        });
        return;
    }

    const baseTag = window.wwg_designInfo?.baseTag;
    let href = baseTag?.href || null;
    if (href) {
        if (!href.startsWith('/')) href = `/${href}`;
        if (!href.endsWith('/')) href = `${href}/`;
    }
    navigator.serviceWorker.register(`${href ?? '/'}serviceworker.js?_wwcv=${window.wwg_cacheVersion}`).catch(error => {
        console.error('Service worker registration failed:', error);
    });
}
/* wwFront:end */

export default app;
