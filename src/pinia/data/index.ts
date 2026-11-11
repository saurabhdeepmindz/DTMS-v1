import type { NativeStoreDefinition } from '../storeTypes';
import { markRaw } from 'vue';
import { defineStore } from 'pinia';
import { useDataState } from './state';
import { useDataGetters } from './getters';
import { useDataCommands } from './commands';
import { useDataWriters } from './writers';

function setupDataStore() {
    const stateRefs = useDataState();
    const getters = useDataGetters(stateRefs);
    const writers = useDataWriters({ stateRefs });
    const commands = useDataCommands({ stateRefs, getters, writers });
    return { ...stateRefs, ...getters, ...commands, writers: markRaw(writers) };
}

export const useDataStore = defineStore('data', setupDataStore) as NativeStoreDefinition<
    'data',
    ReturnType<typeof setupDataStore>
>;

export type DataStore = ReturnType<typeof useDataStore>;
