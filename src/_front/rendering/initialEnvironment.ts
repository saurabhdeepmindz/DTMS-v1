export type InitialEnvironment = {
    version: 1;
    randomSeed: number;
    timestamp: number;
    performanceNow: number;
    viewport: {
        innerWidth: number;
        innerHeight: number;
        devicePixelRatio: number;
    };
};

type RuntimeGlobal = typeof globalThis & {
    window?: Window & typeof globalThis;
};

export function createInitialEnvironment(runtime: RuntimeGlobal = globalThis): InitialEnvironment {
    const randomSeed = new Uint32Array(1);
    runtime.crypto.getRandomValues(randomSeed);
    const browserWindow = runtime.window;

    return {
        version: 1,
        randomSeed: randomSeed[0],
        timestamp: runtime.Date.now(),
        performanceNow: runtime.performance.now(),
        viewport: {
            innerWidth: browserWindow?.innerWidth ?? 1024,
            innerHeight: browserWindow?.innerHeight ?? 768,
            devicePixelRatio: browserWindow?.devicePixelRatio ?? 1,
        },
    };
}

export function parseInitialEnvironment(value: unknown): InitialEnvironment | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;

    const environment = value as Partial<InitialEnvironment>;
    if (environment.version !== 1) return;
    if (!isUint32(environment.randomSeed)) return;
    if (!isValidDateTimestamp(environment.timestamp)) return;
    if (!isNonNegativeFiniteNumber(environment.performanceNow)) return;
    if (!environment.viewport || typeof environment.viewport !== 'object') return;
    if (!isNonNegativeFiniteNumber(environment.viewport.innerWidth)) return;
    if (!isNonNegativeFiniteNumber(environment.viewport.innerHeight)) return;
    if (!isNonNegativeFiniteNumber(environment.viewport.devicePixelRatio)) return;

    return {
        version: 1,
        randomSeed: environment.randomSeed,
        timestamp: environment.timestamp,
        performanceNow: environment.performanceNow,
        viewport: {
            innerWidth: environment.viewport.innerWidth,
            innerHeight: environment.viewport.innerHeight,
            devicePixelRatio: environment.viewport.devicePixelRatio,
        },
    };
}

/**
 * Replaces only the small set of non-deterministic browser APIs that can affect
 * the initial Vue tree. The caller must restore them immediately after SSR or
 * hydration; cryptographic randomness is deliberately never mocked.
 */
export function installInitialEnvironment(
    serializedEnvironment: unknown,
    runtime: RuntimeGlobal = globalThis
): () => void {
    const environment = parseInitialEnvironment(serializedEnvironment);
    if (!environment) return () => {};

    const restorers: Array<() => void> = [];
    try {
        const random = createSeededRandom(environment.randomSeed);
        const mathObjects = new Set<Math>([runtime.Math]);
        if (runtime.window) mathObjects.add(runtime.window.Math);
        for (const math of mathObjects) restorers.push(replaceProperty(math, 'random', random));

        const DeterministicDate = createDeterministicDate(runtime.Date, environment.timestamp);
        restorers.push(replaceProperty(runtime, 'Date', DeterministicDate));
        if (runtime.window && runtime.window !== runtime) {
            restorers.push(replaceProperty(runtime.window, 'Date', DeterministicDate));
        }

        const performanceObjects = new Set<Performance>([runtime.performance]);
        if (runtime.window) performanceObjects.add(runtime.window.performance);
        for (const performance of performanceObjects) {
            restorers.push(replaceProperty(performance, 'now', () => environment.performanceNow));
        }

        if (runtime.window) {
            restorers.push(replaceProperty(runtime.window, 'innerWidth', environment.viewport.innerWidth));
            restorers.push(replaceProperty(runtime.window, 'innerHeight', environment.viewport.innerHeight));
            restorers.push(replaceProperty(runtime.window, 'devicePixelRatio', environment.viewport.devicePixelRatio));
        }
    } catch (error) {
        restoreAll(restorers);
        throw error;
    }

    let restored = false;
    return () => {
        if (restored) return;
        restored = true;
        restoreAll(restorers);
    };
}

function createSeededRandom(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let value = state;
        value = Math.imul(value ^ (value >>> 15), value | 1);
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
        return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
    };
}

function createDeterministicDate(NativeDate: DateConstructor, timestamp: number): DateConstructor {
    const DeterministicDate = function (this: unknown, ...args: unknown[]) {
        if (!new.target) return new NativeDate(timestamp).toString();
        return Reflect.construct(NativeDate, args.length ? args : [timestamp], new.target);
    } as DateConstructor;

    Object.setPrototypeOf(DeterministicDate, NativeDate);
    Object.defineProperty(DeterministicDate, 'prototype', { value: NativeDate.prototype });
    Object.defineProperty(DeterministicDate, 'now', {
        configurable: true,
        value: () => timestamp,
    });
    return DeterministicDate;
}

function replaceProperty(target: object, property: PropertyKey, value: unknown): () => void {
    const descriptor = Object.getOwnPropertyDescriptor(target, property);
    Object.defineProperty(target, property, {
        configurable: true,
        writable: true,
        value,
    });

    return () => {
        if (descriptor) Object.defineProperty(target, property, descriptor);
        else delete (target as Record<PropertyKey, unknown>)[property];
    };
}

function restoreAll(restorers: Array<() => void>): void {
    for (let index = restorers.length - 1; index >= 0; index--) restorers[index]();
}

function isUint32(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 0xffff_ffff;
}

function isValidDateTimestamp(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && !Number.isNaN(new Date(value).getTime());
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}
