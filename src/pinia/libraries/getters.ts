import { computed } from 'vue';
import type { Registry, LibraryItem, LibraryComponent } from '../entities';
import type { LibrariesStateRefs } from './state';

/** Derive values from this application's existing state refs. */
export function useLibrariesGetters(refs: LibrariesStateRefs) {
 
    return {
     };
}

export type LibrariesGetters = ReturnType<typeof useLibrariesGetters>;
