import type { Pinia } from 'pinia';
import { useWebsiteDataStore, type WebsiteDataStore } from './websiteData';
import { useDataStore, type DataStore } from './data';
import { useFrontStore, type FrontStore } from './front';
import { useLibrariesStore, type LibrariesStore } from './libraries';
import { useBackAuthStore } from './backAuth';
import { useBackTableViewsStore } from './backTableViews';
import { useBackTablesStore } from './backTables';
import { useComponentBasesStore } from './componentBases';
import { useEnvVariablesStore } from './envVariables';
import { useHooksStore } from './hooks';
import { useIconsStore } from './icons';
import { useIntegrationsStore } from './integrations';
import { usePopupStore } from './popup';
import { useVariablesStore } from './variables';
 
/** Internal native store access. Extension code uses the public wwLib business APIs. */
export interface StoreRegistry {
    readonly websiteData: WebsiteDataStore;
    readonly data: DataStore;
    readonly front: FrontStore;
    readonly libraries: LibrariesStore;
    readonly backAuth: ReturnType<typeof useBackAuthStore>;
    readonly backTableViews: ReturnType<typeof useBackTableViewsStore>;
    readonly backTables: ReturnType<typeof useBackTablesStore>;
    readonly componentBases: ReturnType<typeof useComponentBasesStore>;
    readonly envVariables: ReturnType<typeof useEnvVariablesStore>;
    readonly hooks: ReturnType<typeof useHooksStore>;
    readonly icons: ReturnType<typeof useIconsStore>;
    readonly integrations: ReturnType<typeof useIntegrationsStore>;
    readonly popups: ReturnType<typeof usePopupStore>;
    readonly variables: ReturnType<typeof useVariablesStore>;
 }

/** Install the single runtime registry; lazy getters return the original Pinia stores. */
export function createStoreRegistry(pinia: Pinia): StoreRegistry {
    const registry: StoreRegistry = Object.freeze({
        get websiteData() {
            return useWebsiteDataStore(pinia);
        },
        get data() {
            return useDataStore(pinia);
        },
        get front() {
            return useFrontStore(pinia);
        },
        get libraries() {
            return useLibrariesStore(pinia);
        },
        get backAuth() {
            return useBackAuthStore(pinia);
        },
        get backTableViews() {
            return useBackTableViewsStore(pinia);
        },
        get backTables() {
            return useBackTablesStore(pinia);
        },
        get componentBases() {
            return useComponentBasesStore(pinia);
        },
        get envVariables() {
            return useEnvVariablesStore(pinia);
        },
        get hooks() {
            return useHooksStore(pinia);
        },
        get icons() {
            return useIconsStore(pinia);
        },
        get integrations() {
            return useIntegrationsStore(pinia);
        },
        get popups() {
            return usePopupStore(pinia);
        },
        get variables() {
            return useVariablesStore(pinia);
        },
     });
    return registry;
}
