import type { LibrariesStateRefs } from './state';
import type { LibraryItem, LibraryComponent } from '../entities';
import type { LibrariesState } from './state';

 
 
/** Private hydration and history writers. Native consumers use the store's commands. */

export function useLibrariesWriters({ stateRefs }: { stateRefs: LibrariesStateRefs }) {
    const writers = {
        /*=============================================m_ÔÔ_m=============================================\
        Libraries
    \================================================================================================*/
 
        /*=============================================m_ÔÔ_m=============================================\
        Sections
    \================================================================================================*/
 
        /*=============================================m_ÔÔ_m=============================================\
        Elements
    \================================================================================================*/
 
        /*=============================================m_ÔÔ_m=============================================\
        Styles
    \================================================================================================*/
 
        /*=============================================m_ÔÔ_m=============================================\
        Classes
    \================================================================================================*/
        setClass(classItem: LibraryItem): void {
            stateRefs.classes.value[classItem.id] = classItem;
        },
 
        /*=============================================m_ÔÔ_m=============================================\
        Components
    \================================================================================================*/
        setComponent(libraryComponent: LibraryComponent): void {
            stateRefs.components.value[libraryComponent.id] = libraryComponent;
        },
     };
    return writers;
}

export type LibrariesWriters = ReturnType<typeof useLibrariesWriters>;
