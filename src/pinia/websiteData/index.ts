import type { NativeStoreDefinition } from '../storeTypes';
import { markRaw } from 'vue';
import { defineStore } from 'pinia';
import { useWebsiteDataState } from './state';
import { useWebsiteDataGetters } from './getters';
import { useWebsiteDataCommands } from './commands';
import { useWebsiteDataWriters } from './writers';

function setupWebsiteDataStore() {
    const stateRefs = useWebsiteDataState();
    const getters = useWebsiteDataGetters(stateRefs);
    const writers = useWebsiteDataWriters({ stateRefs, });
    const commands = useWebsiteDataCommands({ stateRefs, getters, writers });
    return { ...stateRefs, ...getters, ...commands, writers: markRaw(writers) };
}

export const useWebsiteDataStore = defineStore('websiteData', setupWebsiteDataStore) as NativeStoreDefinition<
    'websiteData',
    ReturnType<typeof setupWebsiteDataStore>
>;

export type WebsiteDataStore = ReturnType<typeof useWebsiteDataStore>;
