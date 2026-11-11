 import type { LibraryItem, LibraryComponent } from '../entities';
import type { LibrariesState } from './state';
 
 
 
import type { LibrariesWriters } from './writers';

/** Commands are the native Pinia actions; this composable receives their private dependencies. */
export function useLibrariesCommands({
 writers,
}: {
     writers: LibrariesWriters;
}) {
    const commands = {
        /*=============================================m_ÔÔ_m=============================================\
        Libraries
    \================================================================================================*/
 
        /*=============================================m_ÔÔ_m=============================================\
        Styles
    \================================================================================================*/
 
        /*=============================================m_ÔÔ_m=============================================\
        Classes
    \================================================================================================*/
        setClasses(libraryClasses: LibraryItem[]): void {
            for (const libraryClass of libraryClasses) {
                writers.setClass(libraryClass);
            }
        },
 
        /*=============================================m_ÔÔ_m=============================================\
        Sections
    \================================================================================================*/
 
        /*=============================================m_ÔÔ_m=============================================\
        Elements
    \================================================================================================*/
 
        /*=============================================m_ÔÔ_m=============================================\
        Components
    \================================================================================================*/
        setComponents(libraryComponents: LibraryComponent[]): void {
            for (const libraryComponent of libraryComponents) {
                writers.setComponent(libraryComponent);
            }
        },
     };
    return commands;
}

export type LibrariesCommands = ReturnType<typeof useLibrariesCommands>;
