import { STATIC_STYLE_RUNTIME, type StyleRuntime, type StyleScopeDispose, type StyleScopeStop } from './types';

/**
 * Runs one compiler effect in either static or reactive mode.
 *
 * Static mode executes once and returns the collected cleanup. Reactive mode creates an owning
 * scope, runs the effect inside it, and lets the runtime subscribe to whatever the callback reads.
 */
export function createStyleEffectScope(
    runtime: StyleRuntime,
    callback: (onDispose: StyleScopeDispose) => void
): StyleScopeStop {
    if (runtime === STATIC_STYLE_RUNTIME) {
        return runStaticStyleEffect(callback);
    }

    const scope = runtime.createScope();
    let stopEffect: StyleScopeStop | null = null;

    scope.run(() => {
        stopEffect = runtime.effect(callback);
    });

    return createReactiveStyleEffectStop(() => stopEffect?.(), () => scope.stop());
}

function runStaticStyleEffect(callback: (onDispose: StyleScopeDispose) => void) {
    const cleanups: Array<() => void> = [];
    let disposed = false;

    callback(cleanup => {
        if (disposed) {
            cleanup();
            return;
        }

        cleanups.push(cleanup);
    });

    return () => {
        if (disposed) return;

        disposed = true;
        for (let index = cleanups.length - 1; index >= 0; index--) {
            cleanups[index]();
        }
        cleanups.length = 0;
    };
}

function createReactiveStyleEffectStop(stopEffect: StyleScopeStop, stopScope: StyleScopeStop) {
    let stopped = false;

    return () => {
        if (stopped) return;

        stopped = true;
        stopEffect();
        stopScope();
    };
}
