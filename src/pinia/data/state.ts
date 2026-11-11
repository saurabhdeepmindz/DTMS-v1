import { ref, type UnwrapRef } from 'vue';
import type {
    Registry,
    Collection,
    Formula,
    Workflow,
    PageParameterVariable,
    PluginTrigger,
    WorkflowResults,
} from '../entities';

export function useDataState() {
    return {
        collections: ref<Registry<Collection>>({}),
        pageParameterVariables: ref<Registry<PageParameterVariable>>({}),
        formulas: ref<Registry<Formula>>({}),
        pluginFormulas: ref<Registry<Formula>>({}),
        globalWorkflows: ref<Registry<Workflow>>({}),
        workflowsResults: ref<Registry<WorkflowResults>>({}),
     };
}

export type DataStateRefs = ReturnType<typeof useDataState>;
export type DataState = UnwrapRef<DataStateRefs>;
