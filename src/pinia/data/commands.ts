import type { DataGetters } from './getters';
import type { DataStateRefs } from './state';
import type { Collection, Formula, Workflow, PluginTrigger } from '../entities';
import type { DataWriters } from './writers';
 
 
/** Commands are the native Pinia actions; this composable receives their private dependencies. */
export function useDataCommands({
    stateRefs,
    getters,
    writers,
}: {
    stateRefs: Pick<DataStateRefs, 'collections'>;
    getters: Pick<DataGetters, 'resolvePageParameterVariables'>;
    writers: DataWriters;
}) {
    const commands = {
        setCollections(collections: Collection[]): void {
            for (const collection of collections) {
                if (!collection) continue;
                writers.setCollection({ ...collection, isFetching: collection.mode !== 'static' });
                writers.setCollectionFetching({
                    id: collection.id,
                    isFetching: false,
                    isFetched: collection.mode === 'static',
                });
            }
        },
        setNewCollections(collections: Collection[]): void {
            /* wwFront:start */
            for (const collection of Object.values(stateRefs.collections.value)) {
                if (collection.mode === 'static') continue;
                if (collection.config.isPersistentOnNav) continue;
                writers.deleteCollection(collection.id);
            }
            /* wwFront:end */
            for (const collection of collections) {
                if (!collection) continue;
                if (stateRefs.collections.value[collection.id]) continue;
                writers.setCollection({ ...collection, isFetching: collection.mode !== 'static' });
                writers.setCollectionFetching({
                    id: collection.id,
                    isFetching: false,
                    isFetched: collection.mode === 'static',
                });
            }
        },
        setCollectionOffset: writers.setCollectionOffset,
        setCollection: writers.setCollection,
         setCollectionFetching({
            id,
            isFetching,
            isFetched,
        }: {
            id: string;
            isFetching: boolean;
            isFetched?: boolean;
        }): void {
            writers.setCollectionFetching({ id, isFetching, isFetched });
        },
        setPageParameterVariables(): void {
            writers.removePageParameterVariables();
            const page = wwLib.store.websiteData.page;
            if (!page) return;
            let params = {};
             /* wwFront:start */
            params = wwLib.getFrontRouter().currentRoute._value.params;
            /* wwFront:end */
            const variables = getters.resolvePageParameterVariables.value(page.id);
            for (const variable of variables) {
                writers.setPageParameterVariable({
                    ...variable,
                     /* wwFront:start */
                    // eslint-disable-next-line no-dupe-keys
                    ...{ value: params[variable.id] },
                    /* wwFront:end */
                });
            }
        },
        removePageParameterVariables: writers.removePageParameterVariables,
        // Formulas
        setFormulas(formulas: Formula[]): void {
            for (const formula of formulas) {
                commands.setFormula(formula);
            }
        },
        setFormula(formula: Formula): void {
            if (!formula) return;
            writers.setFormula(formula);
        },
         setPluginFormula(formula: Formula): void {
            if (!formula) return;
            writers.setPluginFormula(formula);
        },
        /*=============================================m_ÔÔ_m=============================================\
        WORKFLOWS
    \================================================================================================*/
        setWorkflowActionResult: writers.setWorkflowActionResult,
        setWorkflowDebugMetadata: writers.setWorkflowDebugMetadata,
        setWorkflowError: writers.setWorkflowError,
        setWorkflowActionLoop: writers.setWorkflowActionLoop,
        setWorkflowActionStream: writers.setWorkflowActionStream,
        setWorkflowVariable: writers.setWorkflowVariable,
        deleteWorkflowVariable: writers.deleteWorkflowVariable,
        initGlobalWorkflows(workflows: Workflow[]): void {
            for (const worfklowData of workflows) {
                commands.initGlobalWorkflow(worfklowData);
            }
        },
        initGlobalWorkflow(worfklowData: Workflow): void {
            if (!worfklowData) return;
            writers.initGlobalWorkflow(worfklowData);
        },
        setGlobalWorkflows(workflows: Workflow[]): void {
            for (const worfklowData of workflows) {
                commands.setGlobalWorkflow(worfklowData);
            }
        },
        setGlobalWorkflow(worfklowData: Workflow): void {
            if (!worfklowData) return;
            writers.setGlobalWorkflow(worfklowData);
        },
        resetWorkflowsResult: writers.resetWorkflowsResult,
        resetWorkflowResult: writers.resetWorkflowResult,
     };
    return commands;
}

export type DataCommands = ReturnType<typeof useDataCommands>;
