import { describe, expect, it, vi } from 'vitest';
import { activateHydratedRuntime, type HydrationRuntimeFailurePhase } from './hydrationRuntime';

function createDependencies({
    redirected = false,
    initializationError,
}: { redirected?: boolean; initializationError?: Error } = {}) {
    const events: string[] = [];
    const failures: Array<{ phase: HydrationRuntimeFailurePhase; error: unknown }> = [];

    return {
        events,
        failures,
        dependencies: {
            blockRuntimeInteractions: () => {
                events.push('block');
            },
            releaseRuntimeInteractions: () => {
                events.push('unblock');
            },
            hydrateApp: () => {
                events.push('hydrate');
            },
            initializeRouteRuntime: async () => {
                events.push('initialize');
                if (initializationError) throw initializationError;
                return redirected
                    ? ({ status: 'redirected' } as const)
                    : ({ status: 'ready', route: { id: 'home' } } as const);
            },
            activateBrowserRuntime: () => {
                events.push('activate');
            },
            releaseStaticProjection: () => {
                events.push('deactivate');
            },
            activateRuntimeLifecycle: () => {
                events.push('lifecycle');
            },
            discardRuntimeLifecycle: () => {
                events.push('discard');
            },
            startRouteDataInitialization: () => {
                events.push('data');
            },
            reportFailure: (phase: HydrationRuntimeFailurePhase, error: unknown) => failures.push({ phase, error }),
        },
    };
}

describe('hydrated runtime activation', () => {
    it('activates the browser runtime before releasing the static projection', async () => {
        const { dependencies, events, failures } = createDependencies();

        await expect(activateHydratedRuntime(dependencies)).resolves.toEqual({ status: 'ready' });
        expect(events).toEqual([
            'block',
            'hydrate',
            'initialize',
            'activate',
            'deactivate',
            'lifecycle',
            'data',
            'unblock',
        ]);
        expect(failures).toEqual([]);
    });

    it('waits for asynchronous runtime CSS takeover before activating lifecycle callbacks', async () => {
        const { dependencies, events } = createDependencies();
        dependencies.releaseStaticProjection = async () => {
            events.push('deactivate-start');
            await Promise.resolve();
            events.push('deactivate-complete');
        };

        await expect(activateHydratedRuntime(dependencies)).resolves.toEqual({ status: 'ready' });
        expect(events).toEqual([
            'block',
            'hydrate',
            'initialize',
            'activate',
            'deactivate-start',
            'deactivate-complete',
            'lifecycle',
            'data',
            'unblock',
        ]);
    });

    it('preserves the static projection and discards runtime lifecycle during a redirect', async () => {
        const { dependencies, events } = createDependencies({ redirected: true });

        await expect(activateHydratedRuntime(dependencies)).resolves.toEqual({ status: 'redirected' });
        expect(events).toEqual(['block', 'hydrate', 'initialize', 'discard']);
    });

    it('preserves the static projection when route initialization fails', async () => {
        const initializationError = new Error('integration failed');
        const { dependencies, events, failures } = createDependencies({ initializationError });

        await expect(activateHydratedRuntime(dependencies)).resolves.toEqual({
            status: 'failed',
            phase: 'runtime-initialization',
        });
        expect(events).toEqual(['block', 'hydrate', 'initialize', 'discard']);
        expect(failures).toEqual([{ phase: 'runtime-initialization', error: initializationError }]);
    });

    it('preserves the static projection when browser activation fails', async () => {
        const activationError = new Error('browser service failed');
        const { dependencies, events, failures } = createDependencies();
        dependencies.activateBrowserRuntime = () => {
            events.push('activate');
            throw activationError;
        };

        await expect(activateHydratedRuntime(dependencies)).resolves.toEqual({
            status: 'failed',
            phase: 'browser-runtime-activation',
        });
        expect(events).toEqual(['block', 'hydrate', 'initialize', 'activate', 'discard']);
        expect(failures).toEqual([{ phase: 'browser-runtime-activation', error: activationError }]);
    });

    it('preserves the static projection when asynchronous browser activation fails', async () => {
        const activationError = new Error('async browser service failed');
        const { dependencies, events, failures } = createDependencies();
        dependencies.activateBrowserRuntime = async () => {
            events.push('activate');
            throw activationError;
        };

        await expect(activateHydratedRuntime(dependencies)).resolves.toEqual({
            status: 'failed',
            phase: 'browser-runtime-activation',
        });
        expect(events).toEqual(['block', 'hydrate', 'initialize', 'activate', 'discard']);
        expect(failures).toEqual([{ phase: 'browser-runtime-activation', error: activationError }]);
    });

    it('reports lifecycle failures after releasing static bindings and still starts route data', async () => {
        const lifecycleError = new Error('mounted workflow failed');
        const { dependencies, events, failures } = createDependencies();
        dependencies.activateRuntimeLifecycle = () => {
            events.push('lifecycle');
            throw lifecycleError;
        };

        await expect(activateHydratedRuntime(dependencies)).resolves.toEqual({ status: 'ready' });
        expect(events).toEqual([
            'block',
            'hydrate',
            'initialize',
            'activate',
            'deactivate',
            'lifecycle',
            'data',
            'unblock',
        ]);
        expect(failures).toEqual([{ phase: 'lifecycle-activation', error: lifecycleError }]);
    });

    it('reports asynchronous route-data failures without delaying mount completion', async () => {
        const dataError = new Error('collection failed');
        const { dependencies, failures } = createDependencies();
        dependencies.startRouteDataInitialization = vi.fn().mockRejectedValue(dataError);

        await expect(activateHydratedRuntime(dependencies)).resolves.toEqual({ status: 'ready' });
        await Promise.resolve();
        expect(failures).toEqual([{ phase: 'route-data-initialization', error: dataError }]);
    });

    it('blocks interactions and discards lifecycle callbacks when Vue hydration fails', async () => {
        const hydrationError = new Error('Vue hydration failed');
        const { dependencies, events } = createDependencies();
        dependencies.hydrateApp = () => {
            events.push('hydrate');
            throw hydrationError;
        };

        await expect(activateHydratedRuntime(dependencies)).rejects.toThrow(hydrationError);
        expect(events).toEqual(['block', 'hydrate', 'discard']);
    });
});
