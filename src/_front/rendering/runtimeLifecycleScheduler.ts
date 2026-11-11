import { renderMode, type RenderMode } from './renderMode';

type RuntimeLifecycleCallback = () => void;

export type RuntimeLifecycleScheduler = {
    schedule: (callback: RuntimeLifecycleCallback) => void;
    activate: () => void;
    discard: () => void;
};

/**
 * Keeps component lifecycle workflows on the traditional runtime side of the
 * static-rendering seam. SSR discards them, CSR runs them immediately, and
 * hydration preserves their Vue ordering until runtime dependencies are ready.
 */
export function createRuntimeLifecycleScheduler(mode: RenderMode): RuntimeLifecycleScheduler {
    let active = mode === 'runtime';
    let discarded = false;
    let pendingCallbacks: RuntimeLifecycleCallback[] = [];

    return {
        schedule(callback) {
            if (mode === 'ssr' || discarded) return;
            if (active) {
                callback();
                return;
            }
            pendingCallbacks.push(callback);
        },
        activate() {
            if (active || discarded || mode === 'ssr') return;

            active = true;
            const callbacks = pendingCallbacks;
            pendingCallbacks = [];
            let firstError: unknown;
            let hasError = false;
            for (const callback of callbacks) {
                try {
                    callback();
                } catch (error) {
                    if (!hasError) firstError = error;
                    hasError = true;
                }
            }
            if (hasError) throw firstError;
        },
        discard() {
            if (active || discarded || mode === 'ssr') return;

            discarded = true;
            pendingCallbacks = [];
        },
    };
}

const runtimeLifecycleScheduler = createRuntimeLifecycleScheduler(renderMode);

export const scheduleRuntimeLifecycle = runtimeLifecycleScheduler.schedule;
export const activateRuntimeLifecycle = runtimeLifecycleScheduler.activate;
export const discardRuntimeLifecycle = runtimeLifecycleScheduler.discard;
