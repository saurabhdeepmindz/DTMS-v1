import { withStoreRegistry } from '@/pinia/testRegistry.test-support';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPwaStore } from './pwaStore';

function createEventTarget() {
    const listeners: Record<string, Array<(payload?: any) => void>> = {};

    return {
        addEventListener: vi.fn((event: string, handler: (payload?: any) => void) => {
            listeners[event] ||= [];
            listeners[event].push(handler);
        }),
        dispatch(event: string, payload?: any) {
            for (const handler of listeners[event] || []) {
                handler(payload);
            }
        },
    };
}

describe('createPwaStore', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    afterEach(() => {
        delete (globalThis as any).wwLib;
    });

    it('initializes the PWA context from the current browser state', async () => {
        const windowEvents = createEventTarget();
        const documentEvents = createEventTarget();
        const connectionEvents = createEventTarget();
        const batteryEvents = createEventTarget();

        const battery = {
            level: 0.75,
            charging: true,
            chargingTime: 12,
            dischargingTime: 24,
            addEventListener: batteryEvents.addEventListener,
        };

        const connection = {
            downlink: 8,
            effectiveType: '4g',
            rtt: 50,
            saveData: false,
            type: 'wifi',
            addEventListener: connectionEvents.addEventListener,
        };

        const navigator = {
            onLine: true,
            connection,
            getBattery: vi.fn().mockResolvedValue(battery),
            userAgent: 'Test Agent',
            userAgentData: { platform: 'iOS' },
            language: 'en',
            languages: ['en', 'fr'],
            vendor: 'Apple',
            maxTouchPoints: 5,
        };

        const wndw = {
            navigator,
            DeviceMotionEvent: function DeviceMotionEvent() {},
            addEventListener: windowEvents.addEventListener,
        };

        const doc = {
            hidden: false,
            addEventListener: documentEvents.addEventListener,
        };

        (globalThis as any).wwLib = withStoreRegistry({
            getFrontWindow: vi.fn(() => wndw),
            getEditorWindow: vi.fn(() => wndw),
            getFrontDocument: vi.fn(() => doc),
            getEditorDocument: vi.fn(() => doc),
        });

        const store = createPwaStore();
        store.start();
        await Promise.resolve();

        expect(store.pwa.value.network).toEqual({
            isOnline: true,
            connection: {
                downlink: 8,
                effectiveType: '4g',
                rtt: 50,
                saveData: false,
                type: 'wifi',
            },
            supported: true,
        });
        expect(store.pwa.value.battery).toEqual({
            level: 0.75,
            charging: true,
            chargingTime: 12,
            dischargingTime: 24,
            supported: true,
        });
        expect(store.pwa.value.pageVisibility).toBe(true);
        expect(store.pwa.value.deviceMotion.supported).toBe(true);
        expect(store.pwa.value.deviceInfo).toEqual({
            userAgent: 'Test Agent',
            platform: 'iOS',
            language: 'en',
            languages: ['en', 'fr'],
            vendor: 'Apple',
            maxTouchPoints: 5,
        });
    });

    it('reacts to runtime updates and keeps stable defaults for unsupported APIs', async () => {
        const windowEvents = createEventTarget();
        const documentEvents = createEventTarget();
        const batteryEvents = createEventTarget();

        const battery = {
            level: 0.2,
            charging: false,
            chargingTime: -1,
            dischargingTime: 120,
            addEventListener: batteryEvents.addEventListener,
        };

        const navigator = {
            onLine: false,
            getBattery: vi.fn().mockResolvedValue(battery),
        };

        const wndw = {
            navigator,
            addEventListener: windowEvents.addEventListener,
        };

        const doc = {
            hidden: true,
            addEventListener: documentEvents.addEventListener,
        };

        (globalThis as any).wwLib = withStoreRegistry({
            getFrontWindow: vi.fn(() => wndw),
            getEditorWindow: vi.fn(() => wndw),
            getFrontDocument: vi.fn(() => doc),
            getEditorDocument: vi.fn(() => doc),
        });

        const store = createPwaStore();
        store.start();
        await Promise.resolve();

        expect(store.pwa.value.network.supported).toBe(false);
        expect(store.pwa.value.network.connection).toEqual({
            downlink: -1,
            effectiveType: 'unknown',
            rtt: -1,
            saveData: false,
            type: 'unknown',
        });
        expect(store.pwa.value.pageVisibility).toBe(false);
        expect(store.pwa.value.deviceMotion.supported).toBe(false);
        expect(store.pwa.value.deviceInfo).toEqual({
            userAgent: '',
            platform: null,
            language: null,
            languages: [],
            vendor: null,
            maxTouchPoints: 0,
        });

        navigator.onLine = true;
        windowEvents.dispatch('online');
        expect(store.pwa.value.network.isOnline).toBe(true);

        doc.hidden = false;
        documentEvents.dispatch('visibilitychange');
        expect(store.pwa.value.pageVisibility).toBe(true);

        battery.level = 0.9;
        batteryEvents.dispatch('levelchange');
        expect(store.pwa.value.battery.level).toBe(0.9);
    });

    it('updates device motion when the browser emits motion events', () => {
        const windowEvents = createEventTarget();
        const documentEvents = createEventTarget();

        const navigator = {
            onLine: true,
        };

        const wndw = {
            navigator,
            DeviceMotionEvent: function DeviceMotionEvent() {},
            addEventListener: windowEvents.addEventListener,
        };

        const doc = {
            hidden: false,
            addEventListener: documentEvents.addEventListener,
        };

        (globalThis as any).wwLib = withStoreRegistry({
            getFrontWindow: vi.fn(() => wndw),
            getEditorWindow: vi.fn(() => wndw),
            getFrontDocument: vi.fn(() => doc),
            getEditorDocument: vi.fn(() => doc),
        });

        const store = createPwaStore();
        store.start();

        windowEvents.dispatch('devicemotion', {
            acceleration: { x: 1, y: 2, z: 3 },
            accelerationIncludingGravity: { x: 4, y: 5, z: 6 },
            rotationRate: { alpha: 7, beta: 8, gamma: 9 },
            interval: 16,
        });

        expect(store.pwa.value.deviceMotion).toEqual({
            acceleration: { x: 1, y: 2, z: 3 },
            accelerationIncludingGravity: { x: 4, y: 5, z: 6 },
            rotationRate: { alpha: 7, beta: 8, gamma: 9 },
            interval: 16,
            supported: true,
        });
    });
});
