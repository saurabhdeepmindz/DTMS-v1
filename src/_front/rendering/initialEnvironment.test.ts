// @vitest-environment jsdom

import { createSSRApp, defineComponent, h } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installInitialEnvironment, parseInitialEnvironment, type InitialEnvironment } from './initialEnvironment';

const INITIAL_ENVIRONMENT: InitialEnvironment = {
    version: 1,
    randomSeed: 0x12345678,
    timestamp: 1_725_000_000_000,
    performanceNow: 12.5,
    viewport: {
        innerWidth: 1024,
        innerHeight: 768,
        devicePixelRatio: 1,
    },
};

describe('initial SSR environment', () => {
    afterEach(() => vi.restoreAllMocks());

    it('replays only bounded non-deterministic API state and restores browser APIs', () => {
        const nativeRandom = Math.random;
        const nativeDate = Date;
        const nativeInnerWidth = window.innerWidth;

        const firstRestore = installInitialEnvironment(INITIAL_ENVIRONMENT);
        const first = readEnvironment();
        firstRestore();

        expect(Math.random).toBe(nativeRandom);
        expect(Date).toBe(nativeDate);
        expect(window.innerWidth).toBe(nativeInnerWidth);

        const secondRestore = installInitialEnvironment(JSON.parse(JSON.stringify(INITIAL_ENVIRONMENT)));
        const second = readEnvironment();
        secondRestore();

        expect(second).toEqual(first);
        expect(JSON.stringify(INITIAL_ENVIRONMENT).length).toBeLessThan(256);
        expect(INITIAL_ENVIRONMENT).not.toHaveProperty('bindings');
        expect(INITIAL_ENVIRONMENT).not.toHaveProperty('values');
    });

    it('keeps Vue SSR and initial hydration identical for volatile APIs', async () => {
        const VolatileContent = defineComponent({
            setup: () => () =>
                h(
                    'output',
                    JSON.stringify({
                        random: Math.random(),
                        now: Date.now(),
                        date: new Date().toISOString(),
                        width: window.innerWidth,
                        height: window.innerHeight,
                        dpr: window.devicePixelRatio,
                        performance: performance.now(),
                    })
                ),
        });

        const restoreServer = installInitialEnvironment(INITIAL_ENVIRONMENT);
        const serverHtml = await renderToString(createSSRApp(VolatileContent));
        restoreServer();

        const mountPoint = document.createElement('div');
        mountPoint.innerHTML = serverHtml;
        document.body.append(mountPoint);
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

        const restoreClient = installInitialEnvironment(INITIAL_ENVIRONMENT);
        const app = createSSRApp(VolatileContent);
        app.mount(mountPoint);
        restoreClient();

        expect(consoleError.mock.calls.flat().join(' ')).not.toMatch(/hydrat|mismatch/i);
        expect(mountPoint.querySelector('output')?.textContent).toContain('"random":0.10615200875326991');
        expect(mountPoint.querySelector('output')?.textContent).toContain('"now":1725000000000');
        app.unmount();
    });

    it('rejects malformed or unbounded serialized environments', () => {
        expect(parseInitialEnvironment(null)).toBeUndefined();
        expect(parseInitialEnvironment({ ...INITIAL_ENVIRONMENT, randomSeed: -1 })).toBeUndefined();
        expect(
            parseInitialEnvironment({ ...INITIAL_ENVIRONMENT, timestamp: Number.POSITIVE_INFINITY })
        ).toBeUndefined();
        expect(
            parseInitialEnvironment({
                ...INITIAL_ENVIRONMENT,
                viewport: { ...INITIAL_ENVIRONMENT.viewport, innerWidth: Number.NaN },
            })
        ).toBeUndefined();
    });

    it('keeps only the fixed non-deterministic API snapshot', () => {
        expect(
            parseInitialEnvironment({
                ...INITIAL_ENVIRONMENT,
                bindings: { huge: 'formula result' },
                viewport: { ...INITIAL_ENVIRONMENT.viewport, unexpected: 'discarded' },
            })
        ).toEqual(INITIAL_ENVIRONMENT);
    });
});

function readEnvironment() {
    return {
        random: [Math.random(), Math.random(), window.Math.random()],
        now: [Date.now(), window.Date.now()],
        dates: [new Date().toISOString(), new window.Date().toISOString(), Date()],
        viewport: [window.innerWidth, window.innerHeight, window.devicePixelRatio],
        performance: [performance.now(), window.performance.now()],
    };
}
