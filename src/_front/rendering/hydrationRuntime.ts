export type HydrationRuntimeFailurePhase =
    | 'runtime-initialization'
    | 'browser-runtime-activation'
    | 'lifecycle-activation'
    | 'route-data-initialization';

type HydrationRuntimeDependencies<Route> = {
    blockRuntimeInteractions: () => void;
    releaseRuntimeInteractions: () => void;
    hydrateApp: () => void;
    initializeRouteRuntime: () => Promise<HydrationRouteInitialization<Route>>;
    activateBrowserRuntime: () => void | Promise<void>;
    releaseStaticProjection: () => void | Promise<void>;
    activateRuntimeLifecycle: () => void;
    discardRuntimeLifecycle: () => void;
    startRouteDataInitialization: (route: Route) => void | Promise<void>;
    reportFailure: (phase: HydrationRuntimeFailurePhase, error: unknown) => void;
};

export type HydrationRouteInitialization<Route> = { status: 'ready'; route: Route } | { status: 'redirected' };

export type HydrationRuntimeResult =
    | { status: 'ready' }
    | { status: 'redirected' }
    | {
          status: 'failed';
          phase: Extract<HydrationRuntimeFailurePhase, 'runtime-initialization' | 'browser-runtime-activation'>;
      };

/**
 * Commits a hydrated Vue tree to the traditional browser runtime only after its
 * route and browser prerequisites are ready. Failed and redirected transitions
 * preserve the deterministic static projection and discard queued runtime lifecycle
 * callbacks instead of exposing a partially initialized application.
 */
export async function activateHydratedRuntime<Route>({
    blockRuntimeInteractions,
    releaseRuntimeInteractions,
    hydrateApp,
    initializeRouteRuntime,
    activateBrowserRuntime,
    releaseStaticProjection,
    activateRuntimeLifecycle,
    discardRuntimeLifecycle,
    startRouteDataInitialization,
    reportFailure,
}: HydrationRuntimeDependencies<Route>): Promise<HydrationRuntimeResult> {
    let initialization: HydrationRouteInitialization<Route>;

    blockRuntimeInteractions();
    try {
        hydrateApp();
    } catch (error) {
        discardRuntimeLifecycle();
        throw error;
    }

    try {
        initialization = await initializeRouteRuntime();
    } catch (error) {
        reportFailure('runtime-initialization', error);
        discardRuntimeLifecycle();
        return { status: 'failed', phase: 'runtime-initialization' };
    }

    if (initialization.status === 'redirected') {
        discardRuntimeLifecycle();
        return { status: 'redirected' };
    }

    try {
        await activateBrowserRuntime();
    } catch (error) {
        reportFailure('browser-runtime-activation', error);
        discardRuntimeLifecycle();
        return { status: 'failed', phase: 'browser-runtime-activation' };
    }

    await releaseStaticProjection();

    try {
        activateRuntimeLifecycle();
    } catch (error) {
        reportFailure('lifecycle-activation', error);
    }

    try {
        Promise.resolve(startRouteDataInitialization(initialization.route)).catch(error => {
            reportFailure('route-data-initialization', error);
        });
    } catch (error) {
        reportFailure('route-data-initialization', error);
    }

    releaseRuntimeInteractions();
    return { status: 'ready' };
}
