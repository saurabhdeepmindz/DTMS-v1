import { describe, expect, it, vi } from 'vitest';
import { createPluginLifecycleScheduler } from './pluginLifecycleScheduler';

describe('plugin lifecycle scheduler', () => {
    it('keeps registration inert until runtime activation', async () => {
        const scheduler = createPluginLifecycleScheduler();
        const initialize = vi.fn();

        const initialized = scheduler.register(initialize);
        await Promise.resolve();

        expect(initialize).not.toHaveBeenCalled();

        await scheduler.activate();
        await initialized;

        expect(initialize).toHaveBeenCalledOnce();
    });

    it('activates all initializers exactly once across repeated activation', async () => {
        const scheduler = createPluginLifecycleScheduler();
        const first = vi.fn();
        const second = vi.fn();

        scheduler.register(first);
        scheduler.register(second);

        await Promise.all([scheduler.activate(), scheduler.activate()]);

        expect(first).toHaveBeenCalledOnce();
        expect(second).toHaveBeenCalledOnce();
    });

    it('initializes plugins registered after activation immediately', async () => {
        const scheduler = createPluginLifecycleScheduler();
        const initialize = vi.fn();

        await scheduler.activate();
        await scheduler.register(initialize);

        expect(initialize).toHaveBeenCalledOnce();
    });
});
