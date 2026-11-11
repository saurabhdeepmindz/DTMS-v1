import { computed } from 'vue';
import type {
    PluginConfiguration,
    DataRecord,
    Registry,
    Formula,
    Workflow,
    PageParameterVariable,
    PluginTrigger,
} from '../entities';
import type { DataStateRefs, DataState } from './state';
import * as _ from 'lodash-es';

import { extractPathParameters } from '@/_common/helpers/urlParametersParsing';

/** Derive values from this application's existing state refs. */
export function useDataGetters(refs: DataStateRefs) {
    const resolvePaginationOptions = computed(
        () =>
            (id: string): { total?: number; limit: number; offset: number } | null => {
                const collection = refs.collections.value[id];
                if (!collection) return null;
                if (!collection.limit) return null;
                return {
                    total: collection.total,
                    limit: parseInt(wwLib.wwFormula.getValue(collection.limit)),
                    offset: collection.offset || 0,
                };
            }
    );
    const resolvedPageCollectionIndex = computed((): number | string => {
 
        /* wwFront:start */
        // eslint-disable-next-line no-unreachable
        const pageId = wwLib.store.websiteData.pageId;
        const [, pageIndex] = pageId.split('_');
        return pageIndex || 0;
        /* wwFront:end */
    });
    const pageCollectionData = computed((): unknown => {
         /* wwFront:start */
        // eslint-disable-next-line no-unreachable
        return wwLib.store.websiteData.page.data;
        /* wwFront:end */
    });
    const resolvePageParameterVariables = computed(() => (id: string): PageParameterVariable[] => {
        const website = wwLib.store.websiteData;
        const page = website.pagesById[id] || website.pagesByLinkId[id];
        if (!page || !page.paths) return [];
        return extractPathParameters(page.paths.default).map(({ name, defaultValue }) => ({
            type: 'query',
            id: name,
            name,
            value: defaultValue,
            defaultValue: defaultValue,
            pageId: page.id,
            queryName: 'wwParam-' + name,
        }));
    });
    const allFormulas = computed((): Registry<Formula> => {
        return { ...refs.formulas.value, ...refs.pluginFormulas.value };
    });
    const pluginActions = computed((): Registry<DataRecord> => {
        const store = wwLib.store.componentBases;
        const website = wwLib.store.websiteData;
        return Object.values<PluginConfiguration>(store.configurations)
            .filter(config => config.actions)
            .map(config => {
                const plugin = website.pluginsByComponentId[config.name] || website.pluginsByNamespace[config.name];
                // ignore the pruduction version of the plugin if the dev version is available
                if (!plugin || (plugin.isDev && !config.wwDev)) return [];
                return config.actions.map(action => ({
                    ...action,
                    pluginId: plugin && plugin.id,
                }));
            })
            .flat()
            .filter(action => action.pluginId)
            .reduce((obj, item) => {
                const id = `${item.pluginId}-${item.code}`;
                return { ...obj, [id]: { ...item, id } };
            }, {});
    });
     const workflowResultsById = computed((): DataState['workflowsResults'] => refs.workflowsResults.value);
    const frontendWorkflows = computed((): Registry<Workflow> => {
        return Object.entries(refs.globalWorkflows.value).reduce((acc, [id, workflow]) => {
            if (workflow.type !== 'back') acc[id] = workflow;
            return acc;
        }, {});
    });
    const backendWorkflows = computed((): Registry<Workflow> => {
        return Object.entries(refs.globalWorkflows.value).reduce((acc, [id, workflow]) => {
            if (workflow.type === 'back') acc[id] = workflow;
            return acc;
        }, {});
    });
    const resolveBackendWorkflowFolders = computed(
        () =>
            (trigger?: string): Array<{ label: string; value: string }> => {
                const backendWorkflowList = Object.values(backendWorkflows.value);
                const workflows =
                    !trigger || ['ww-api', 'ww-middleware'].includes(trigger)
                        ? backendWorkflowList.filter(w => w.trigger == trigger)
                        : backendWorkflowList.filter(
                              w => !!w.trigger && !['ww-api', 'ww-middleware'].includes(w.trigger)
                          );
                return workflows.filter(({ folder }) => folder).map(({ folder }) => ({ label: folder, value: folder }));
            }
    );

    return {
        resolvePaginationOptions,
        resolvedPageCollectionIndex,
        pageCollectionData,
        resolvePageParameterVariables,
        allFormulas,
        pluginActions,
         workflowResultsById,
        frontendWorkflows,
        backendWorkflows,
        resolveBackendWorkflowFolders,
    };
}

export type DataGetters = ReturnType<typeof useDataGetters>;
