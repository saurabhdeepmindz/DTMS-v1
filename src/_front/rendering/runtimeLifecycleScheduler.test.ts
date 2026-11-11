import { describe, expect, it, vi } from 'vitest';
import { createRuntimeLifecycleScheduler } from './runtimeLifecycleScheduler';

describe('runtime lifecycle scheduler', () => {
    it('runs traditional runtime callbacks immediately', () => {
        const scheduler = createRuntimeLifecycleScheduler('runtime');
        const callback = vi.fn();

        scheduler.schedule(callback);

        expect(callback).toHaveBeenCalledOnce();
    });

    it('discards lifecycle callbacks during SSR', () => {
        const scheduler = createRuntimeLifecycleScheduler('ssr');
        const callback = vi.fn();

        scheduler.schedule(callback);
        scheduler.activate();

        expect(callback).not.toHaveBeenCalled();
    });

    it('discards pending and future callbacks after a failed hydration transition', () => {
        const scheduler = createRuntimeLifecycleScheduler('hydrate');
        const pendingCallback = vi.fn();
        const futureCallback = vi.fn();

        scheduler.schedule(pendingCallback);
        scheduler.discard();
        scheduler.schedule(futureCallback);
        scheduler.activate();

        expect(pendingCallback).not.toHaveBeenCalled();
        expect(futureCallback).not.toHaveBeenCalled();
    });

    it('replays hydrated lifecycle callbacks in registration order after activation', () => {
        const scheduler = createRuntimeLifecycleScheduler('hydrate');
        const calls: string[] = [];

        scheduler.schedule(() => calls.push('created'));
        scheduler.schedule(() => calls.push('mounted'));
        expect(calls).toEqual([]);

        scheduler.activate();
        scheduler.activate();

        expect(calls).toEqual(['created', 'mounted']);
    });

    it('runs every queued callback before surfacing the first failure', () => {
        const scheduler = createRuntimeLifecycleScheduler('hydrate');
        const second = vi.fn();
        const failure = new Error('lifecycle failed');
        scheduler.schedule(() => {
            throw failure;
        });
        scheduler.schedule(second);

        expect(() => scheduler.activate()).toThrow(failure);
        expect(second).toHaveBeenCalledOnce();
    });
});
