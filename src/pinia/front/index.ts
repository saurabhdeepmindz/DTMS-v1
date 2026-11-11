import type { NativeStoreDefinition } from '../storeTypes';
import { markRaw } from 'vue';
import { defineStore } from 'pinia';
import { useFrontState } from './state';
import { useFrontGetters } from './getters';
import { useFrontCommands } from './commands';
import { useFrontWriters } from './writers';

function setupFrontStore() {
    const stateRefs = useFrontState();
    const getters = useFrontGetters(stateRefs);
    const writers = useFrontWriters({ stateRefs });
    const commands = useFrontCommands({ writers });
    return { ...stateRefs, ...getters, ...commands, writers: markRaw(writers) };
}

export const useFrontStore = defineStore('front', setupFrontStore) as NativeStoreDefinition<
    'front',
    ReturnType<typeof setupFrontStore>
>;

export type FrontStore = ReturnType<typeof useFrontStore>;
