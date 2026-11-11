import type { DriverContract } from 'flydrive/types';

type StorageDriverFactory = (
    visibility: 'public' | 'private',
    connection: ConnectionConfig,
    runtimeConfig: StorageRuntimeConfig
) => DriverContract;

const storageDrivers: Record<string, StorageDriverFactory> = {};

export function registerStorageDriver(type: string, handler: StorageDriverFactory) {
    if (storageDrivers[type]) throw new Error(`Storage driver type "${type}" is already registered`);
    storageDrivers[type] = handler;
}

export function getStorageDriver(type: string): StorageDriverFactory | undefined {
    return storageDrivers[type];
}

export default {
    registerStorageDriver,
    getStorageDriver,
};
