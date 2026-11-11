import type { NativeStoreDefinition } from '../storeTypes';
import { markRaw } from 'vue';
import { defineStore } from 'pinia';
import { useLibrariesState } from './state';
 import { useLibrariesCommands } from './commands';
import { useLibrariesWriters } from './writers';

function setupLibrariesStore() {
    const stateRefs = useLibrariesState();
     const writers = useLibrariesWriters({ stateRefs });
    const commands = useLibrariesCommands({ writers });
    return {
        ...stateRefs,
         ...commands,
        writers: markRaw(writers),
    };
}

export const useLibrariesStore = defineStore('libraries', setupLibrariesStore) as NativeStoreDefinition<
    'libraries',
    ReturnType<typeof setupLibrariesStore>
>;

export type LibrariesStore = ReturnType<typeof useLibrariesStore>;
