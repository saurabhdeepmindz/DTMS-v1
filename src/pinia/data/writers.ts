import type { DataStateRefs } from './state';
import type { Collection, Formula, Workflow, PageParameterVariable, PluginTrigger } from '../entities';
import type { DataState } from './state';
import { set } from 'lodash-es';
import { markRaw, toRaw } from 'vue';

/** Private hydration and history writers. Native consumers use the store's commands. */

export function useDataWriters({ stateRefs }: { stateRefs: DataStateRefs }) {
    const writers = {
        setCollection(collection: Collection): void {
            if (!stateRefs.collections.value[collection.id])
                stateRefs.collections.value[collection.id] = {} as Collection;
            for (const key in collection) {
                if (key === 'data') {
                    if (collection.data) {
                        set(stateRefs.collections.value[collection.id], 'data', markRaw(toRaw(collection.data)));
                    } else {
                        set(stateRefs.collections.value[collection.id], 'data', null);
                    }
                } else if (key === 'fields') {
                    if (Object.keys(collection.fields).length || !stateRefs.collections.value[collection.id].fields)
                        set(stateRefs.collections.value[collection.id], 'fields', collection.fields);
                } else if (key === 'offset' || key === 'total') {
                    set(stateRefs.collections.value[collection.id], key, collection[key] || 0);
                } else set(stateRefs.collections.value[collection.id], key, collection[key]);
            }
        },
        setCollectionOffset({ collectionId, offset }: { collectionId: string; offset: number }): void {
            if (!stateRefs.collections.value[collectionId]) return;
            set(stateRefs.collections.value[collectionId], 'offset', offset);
        },
        deleteCollection(collectionId: string): void {
            delete stateRefs.collections.value[collectionId];
        },
         setCollectionFetching({
            id,
            isFetching,
            isFetched,
        }: {
            id: string;
            isFetching: boolean;
            isFetched?: boolean;
        }): void {
            set(stateRefs.collections.value[id], 'isFetching', isFetching);
            if (isFetched !== undefined) set(stateRefs.collections.value[id], 'isFetched', isFetched);
            else set(stateRefs.collections.value[id], 'isFetched', !isFetching);
        },
        // Variables
        setPageParameterVariable(variable: PageParameterVariable): void {
            if (!stateRefs.pageParameterVariables.value[variable.id]) {
                stateRefs.pageParameterVariables.value[variable.id] = variable;
            } else {
                Object.assign(stateRefs.pageParameterVariables.value[variable.id], variable);
            }
        },
        removePageParameterVariables(): void {
            stateRefs.pageParameterVariables.value = {};
        },
        // Formulas
        setFormula(formula: Formula): void {
            set(stateRefs.formulas.value, formula.id, formula);
        },
         setPluginFormula(formula: Formula): void {
            set(stateRefs.pluginFormulas.value, formula.id, formula);
        },
        /*=============================================m_ÔÔ_m=============================================\
        WORKFLOWS
    \================================================================================================*/
        setWorkflowActionResult({
            workflowId,
            actionId,
            result,
            error,
            config,
        }: {
            workflowId: string;
            actionId: string;
            result: unknown;
            error?: unknown;
            config?: unknown;
        }): void {
            set(stateRefs.workflowsResults.value, `${workflowId}.${actionId}.result`, result);
            set(stateRefs.workflowsResults.value, `${workflowId}.${actionId}.error`, error);
            if (config !== undefined) {
                set(stateRefs.workflowsResults.value, `${workflowId}.${actionId}.config`, config);
            }
        },
        setWorkflowDebugMetadata({ workflowId, metadata }: { workflowId: string; metadata: unknown }): void {
            set(stateRefs.workflowsResults.value, `${workflowId}.__metadata`, metadata || null);
        },
        setWorkflowError({ workflowId, value }: { workflowId: string; value: unknown }): void {
            set(stateRefs.workflowsResults.value, `${workflowId}.error`, value);
        },
        setWorkflowActionLoop({
            workflowId,
            actionId,
            loop,
        }: {
            workflowId: string;
            actionId: string;
            loop: unknown;
        }): void {
            set(stateRefs.workflowsResults.value, `${workflowId}.${actionId}.loop`, loop);
        },
        setWorkflowActionStream({
            workflowId,
            actionId,
            stream,
        }: {
            workflowId: string;
            actionId: string;
            stream: unknown;
        }): void {
            set(stateRefs.workflowsResults.value, `${workflowId}.${actionId}.stream`, stream);
        },
        setWorkflowVariable({
            workflowId,
            actionId,
            value,
            type,
            scopeId,
        }: {
            workflowId: string;
            actionId: string;
            value: unknown;
            type: string;
            scopeId?: string;
        }): void {
            set(stateRefs.workflowsResults.value, `${workflowId}.variables.${actionId}`, { value, type, scopeId });
        },
        deleteWorkflowVariable({ workflowId, actionId }: { workflowId: string; actionId: string }): void {
            if (stateRefs.workflowsResults.value[workflowId]?.variables) {
                delete stateRefs.workflowsResults.value[workflowId].variables[actionId];
            }
        },
        initGlobalWorkflow(workflowData: Workflow): void {
            set(stateRefs.globalWorkflows.value, workflowData.id, workflowData);
        },
        setGlobalWorkflow(workflowData: Workflow): void {
            const currentWorkflow = stateRefs.globalWorkflows.value[workflowData.id];
            if (currentWorkflow?.version !== undefined && workflowData.version === undefined) {
                set(stateRefs.globalWorkflows.value, workflowData.id, {
                    ...workflowData,
                    version: currentWorkflow.version,
                });
                return;
            }
            set(stateRefs.globalWorkflows.value, workflowData.id, workflowData);
        },
        resetWorkflowsResult(): void {
            stateRefs.workflowsResults.value = {};
        },
        resetWorkflowResult({ workflowId }: { workflowId: string }): void {
            if (stateRefs.workflowsResults.value[workflowId]) {
                const variables = stateRefs.workflowsResults.value[workflowId].variables;
                stateRefs.workflowsResults.value[workflowId] = variables ? { variables } : {};
            }
        },
     };
    return writers;
}

export type DataWriters = ReturnType<typeof useDataWriters>;
