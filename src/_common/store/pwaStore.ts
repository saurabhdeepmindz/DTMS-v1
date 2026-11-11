import { ref, type Ref } from 'vue';

type PwaNetworkConnection = {
    downlink: number;
    effectiveType: string;
    rtt: number;
    saveData: boolean;
    type: string;
};

type PwaNetworkState = {
    isOnline: boolean;
    connection: PwaNetworkConnection;
    supported: boolean;
};

type PwaBatteryState = {
    level: number;
    charging: boolean;
    chargingTime: number;
    dischargingTime: number;
    supported: boolean;
};

type PwaVector3 = {
    x: number;
    y: number;
    z: number;
};

type PwaRotationRate = {
    alpha: number;
    beta: number;
    gamma: number;
};

type PwaDeviceMotionState = {
    acceleration: PwaVector3;
    accelerationIncludingGravity: PwaVector3;
    rotationRate: PwaRotationRate;
    interval: number;
    supported: boolean;
};

type PwaDeviceInfo = {
    userAgent: string;
    platform: string | null;
    language: string | null;
    languages: string[];
    vendor: string | null;
    maxTouchPoints: number;
};

export type PwaContext = {
    network: PwaNetworkState;
    battery: PwaBatteryState;
    pageVisibility: boolean;
    deviceMotion: PwaDeviceMotionState;
    deviceInfo: PwaDeviceInfo;
};

type BrowserBattery = {
    level?: number;
    charging?: boolean;
    chargingTime?: number;
    dischargingTime?: number;
    addEventListener: (event: string, handler: () => void) => void;
};

type BrowserConnection = Partial<PwaNetworkConnection> & {
    addEventListener?: (event: string, handler: () => void) => void;
};

type BrowserNavigator = Navigator & {
    connection?: BrowserConnection;
    getBattery?: () => Promise<BrowserBattery>;
    userAgentData?: {
        platform?: string;
    };
};

type BrowserDocument = Document & {
    hidden: boolean;
};

type BrowserWindow = Window &
    typeof globalThis & {
        navigator: BrowserNavigator;
        DeviceMotionEvent?: typeof DeviceMotionEvent;
    };

type BrowserDeviceMotionEvent = {
    acceleration?: PwaVector3 | null;
    accelerationIncludingGravity?: PwaVector3 | null;
    rotationRate?: PwaRotationRate | null;
    interval?: number | null;
};

export type PwaStore = {
    pwa: Ref<PwaContext>;
    start: () => void;
};

function createDefaultNetworkConnection(): PwaNetworkConnection {
    return {
        downlink: -1,
        effectiveType: 'unknown',
        rtt: -1,
        saveData: false,
        type: 'unknown',
    };
}

function createDefaultBatteryState(): PwaBatteryState {
    return {
        level: -1,
        charging: false,
        chargingTime: -1,
        dischargingTime: -1,
        supported: false,
    };
}

function createDefaultDeviceMotionState(): PwaDeviceMotionState {
    return {
        acceleration: { x: -1, y: -1, z: -1 },
        accelerationIncludingGravity: { x: -1, y: -1, z: -1 },
        rotationRate: { alpha: -1, beta: -1, gamma: -1 },
        interval: -1,
        supported: false,
    };
}

function createDefaultDeviceInfo(): PwaDeviceInfo {
    return {
        userAgent: '',
        platform: null,
        language: null,
        languages: [],
        vendor: null,
        maxTouchPoints: 0,
    };
}

export function createDefaultPwaContext(): PwaContext {
    return {
        network: {
            isOnline: false,
            connection: createDefaultNetworkConnection(),
            supported: false,
        },
        battery: createDefaultBatteryState(),
        pageVisibility: false,
        deviceMotion: createDefaultDeviceMotionState(),
        deviceInfo: createDefaultDeviceInfo(),
    };
}

function getWindow(): BrowserWindow | null {
    let wndw: BrowserWindow | null = null;

    /* wwFront:start */
    wndw = wwLib.getFrontWindow() as BrowserWindow;
    /* wwFront:end */

 
    return wndw;
}

function getDocument(): BrowserDocument | null {
    let doc: BrowserDocument | null = null;

    /* wwFront:start */
    doc = wwLib.getFrontDocument() as BrowserDocument;
    /* wwFront:end */

 
    return doc;
}

function getNavigator(): BrowserNavigator | undefined {
    return getWindow()?.navigator;
}

function createNetworkState(navigator?: BrowserNavigator): PwaNetworkState {
    return {
        isOnline: navigator?.onLine ?? false,
        connection: navigator?.connection
            ? {
                  downlink: navigator.connection.downlink ?? -1,
                  effectiveType: navigator.connection.effectiveType ?? 'unknown',
                  rtt: navigator.connection.rtt ?? -1,
                  saveData: navigator.connection.saveData ?? false,
                  type: navigator.connection.type ?? 'unknown',
              }
            : createDefaultNetworkConnection(),
        supported: !!navigator && 'connection' in navigator,
    };
}

function createDeviceInfo(navigator?: BrowserNavigator): PwaDeviceInfo {
    if (!navigator) return createDefaultDeviceInfo();

    return {
        userAgent: navigator.userAgent || '',
        platform: navigator.userAgentData?.platform ?? navigator.platform ?? null,
        language: navigator.language ?? null,
        languages: Array.isArray(navigator.languages) ? [...navigator.languages] : [],
        vendor: navigator.vendor ?? null,
        maxTouchPoints: navigator.maxTouchPoints ?? 0,
    };
}

export function createPwaStore(): PwaStore {
    const pwa = ref<PwaContext>(createDefaultPwaContext());
    let started = false;

    function updateNetwork() {
        pwa.value.network = createNetworkState(getNavigator());
    }

    function updateBattery(battery?: BrowserBattery | null) {
        const currentBattery = pwa.value.battery;

        pwa.value.battery = {
            level: battery?.level ?? currentBattery.level,
            charging: battery?.charging ?? currentBattery.charging,
            chargingTime: battery?.chargingTime ?? currentBattery.chargingTime,
            dischargingTime: battery?.dischargingTime ?? currentBattery.dischargingTime,
            supported: !!getNavigator()?.getBattery,
        };
    }

    async function initBattery() {
        const navigator = getNavigator();
        if (!navigator?.getBattery) {
            pwa.value.battery = createDefaultBatteryState();
            return;
        }

        const battery = await navigator.getBattery();
        updateBattery(battery);

        battery.addEventListener('chargingchange', () => updateBattery(battery));
        battery.addEventListener('levelchange', () => updateBattery(battery));
        battery.addEventListener('chargingtimechange', () => updateBattery(battery));
        battery.addEventListener('dischargingtimechange', () => updateBattery(battery));
    }

    function updatePageVisibility() {
        const doc = getDocument();
        pwa.value.pageVisibility = !!doc && !doc.hidden;
    }

    function updateDeviceMotion(event: BrowserDeviceMotionEvent | null = null) {
        const wndw = getWindow();
        const currentDeviceMotion = pwa.value.deviceMotion;

        pwa.value.deviceMotion = {
            acceleration: event?.acceleration || currentDeviceMotion.acceleration,
            accelerationIncludingGravity:
                event?.accelerationIncludingGravity || currentDeviceMotion.accelerationIncludingGravity,
            rotationRate: event?.rotationRate || currentDeviceMotion.rotationRate,
            interval: event?.interval ?? currentDeviceMotion.interval,
            supported: !!wndw && 'DeviceMotionEvent' in wndw,
        };
    }

    function updateDeviceInfo() {
        pwa.value.deviceInfo = createDeviceInfo(getNavigator());
    }

    function start() {
        if (started) return;

        const wndw = getWindow();
        const doc = getDocument();
        const navigator = getNavigator();

        if (!wndw || !doc || !navigator) return;
        started = true;

        updateNetwork();
        updatePageVisibility();
        updateDeviceMotion();
        updateDeviceInfo();
        void initBattery().catch(() => {
            pwa.value.battery = createDefaultBatteryState();
        });

        wndw.addEventListener('online', updateNetwork);
        wndw.addEventListener('offline', updateNetwork);
        navigator.connection?.addEventListener?.('change', updateNetwork);

        doc.addEventListener('visibilitychange', updatePageVisibility);
        if ('DeviceMotionEvent' in wndw) {
            wndw.addEventListener('devicemotion', updateDeviceMotion as EventListener);
        }
    }

    return {
        pwa,
        start,
    };
}
