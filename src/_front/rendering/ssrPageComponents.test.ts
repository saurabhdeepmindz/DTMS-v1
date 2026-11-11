import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerSsrPageComponents } from './ssrPageComponents';

const { captureClientIslandError, configurations, isKnownClientIsland, registerClientIsland } = vi.hoisted(() => ({
    configurations: {} as Record<string, { staticRendering?: boolean }>,
    captureClientIslandError: vi.fn(),
    isKnownClientIsland: vi.fn(() => false),
    registerClientIsland: vi.fn(),
}));

vi.mock('./clientIslandContext', () => ({
    captureClientIslandError,
    createClientIslandBaseId: (type: string, baseId: string) => `${type}-base:${baseId}`,
    isKnownClientIsland,
    registerClientIsland,
}));

describe('registerSsrPageComponents', () => {
    beforeEach(() => {
        vi.stubGlobal('wwLib', { store: { componentBases: { configurations } } });
        for (const key of Object.keys(configurations)) delete configurations[key];
        captureClientIslandError.mockReset();
        isKnownClientIsland.mockReset().mockReturnValue(false);
        registerClientIsland.mockReset();
    });

    it('does not import a component that explicitly opts out of static rendering', async () => {
        configurations['wwobject-browser-only'] = { staticRendering: false };
        const load = vi.fn();
        const app = { component: vi.fn() };

        await registerSsrPageComponents(app as never, [
            {
                baseId: 'browser-only',
                load,
                name: 'wwobject-browser-only',
                type: 'element',
            },
        ]);

        expect(load).not.toHaveBeenCalled();
        expect(registerClientIsland).toHaveBeenCalledWith('element-base:browser-only');
        expect(app.component).toHaveBeenCalledWith('wwobject-browser-only', expect.anything());
    });

    it('does not retry a component module already classified as a client island', async () => {
        isKnownClientIsland.mockReturnValue(true);
        const load = vi.fn();
        const app = { component: vi.fn() };

        await registerSsrPageComponents(app as never, [
            {
                baseId: 'broken',
                load,
                name: 'wwobject-broken',
                type: 'element',
            },
        ]);

        expect(isKnownClientIsland).toHaveBeenCalledWith('element-base:broken');
        expect(load).not.toHaveBeenCalled();
        expect(captureClientIslandError).not.toHaveBeenCalled();
        expect(app.component).toHaveBeenCalledWith('wwobject-broken', expect.anything());
    });

    it('turns a component module load failure into one base client island', async () => {
        const error = new Error('window is not defined');
        const app = { component: vi.fn() };

        await registerSsrPageComponents(app as never, [
            {
                baseId: 'broken',
                load: () => Promise.reject(error),
                name: 'wwobject-broken',
                type: 'element',
            },
        ]);

        expect(captureClientIslandError).toHaveBeenCalledWith('element-base:broken', error, {
            category: 'component-module-load-error',
            componentName: 'wwobject-broken',
            phase: 'component-module-load',
        });
        expect(app.component).toHaveBeenCalledWith('wwobject-broken', expect.anything());
    });

    it('loads component modules with bounded concurrency', async () => {
        let activeLoads = 0;
        let maxActiveLoads = 0;
        const app = { component: vi.fn() };
        const loaders = [];

        for (let index = 0; index < 8; index++) {
            loaders.push({
                baseId: `base-${index}`,
                name: `wwobject-base-${index}`,
                type: 'element' as const,
                load: async () => {
                    activeLoads++;
                    maxActiveLoads = Math.max(maxActiveLoads, activeLoads);
                    await new Promise(resolve => setTimeout(resolve, 5));
                    activeLoads--;
                    return { default: { render: () => null } };
                },
            });
        }

        await registerSsrPageComponents(app as never, loaders);

        expect(maxActiveLoads).toBe(4);
        expect(app.component).toHaveBeenCalledTimes(8);
    });
});
