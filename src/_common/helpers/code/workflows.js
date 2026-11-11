import { executeCode, getValue as _getValue } from '@/_common/helpers/code/customCode.js';
import { executeComponentAction } from '@/_common/use/useActions.js';
import { detectInfinityLoop } from '@/_common/helpers/code/workflowsCallstack.js';
import { applyVariableUpdate } from '@/_common/helpers/updateVariable.js';
import { getFrontWorkflowCapabilities } from '@/_common/helpers/workflowVersion';
import { set } from 'lodash-es';
import { unref } from 'vue';

import { executeBackendWorkflow, parseSSEStreamAsync } from '@/_common/helpers/code/backendWorkflows.js';

import { betterFetch } from '@better-fetch/fetch';
import integrationsCore from '@/extensions/integrations/index.js';

 
export async function executeWorkflow(
    workflow,
    { context = {}, event = {}, callstack = [], isError, executionContext = {}, internal } = {}
) {
 
    let error, result;
    if (!workflow) return {};
    callstack = [...callstack, workflow.id];

    // Save callstack log
    if (!context.callstackLog) {
        context.callstackLog = [{ workflowId: workflow.id, traceId: executionContext.traceId, entry: true }];
    } else {
        context.callstackLog = [
            ...context.callstackLog,
            { workflowId: workflow.id, traceId: executionContext.traceId },
        ];
    }

    if (!context.traceId) {
        context.traceId = crypto.randomUUID();
    }

    if (detectInfinityLoop(callstack)) {
         return {};
    }

 
    if (!isError) {
         ({ error, result } = await new Promise(async (resolve, reject) => {
            resolve(
                await executeWorkflowActions(workflow, workflow.firstAction, {
                    context,
                    event,
                    callstack,
                    isError: false,
                    executionContext,
                    internal,
                    returnResult: resolve,
                })
            );
        }));
    }

    if (error) {
        if (internal) {
            set(context.component, `workflowsResults.${workflow.id}.error`, convertErrorToObject(error));
        } else {
            await wwLib.store.data.setWorkflowError({
                workflowId: workflow.id,
                value: convertErrorToObject(error),
            });
        }
    }

    // Execute error workflow
    if (isError || error) {
 
        const { result: errorResult } = await new Promise(async (resolve, reject) => {
            resolve(
                await executeWorkflowActions(workflow, workflow.firstErrorAction, {
                    context,
                    event,
                    callstack,
                    isError: true,
                    executionContext,
                    internal,
                    returnResult: resolve,
                })
            );
        });
         return { error, result: errorResult };
    }

     return { error, result };
}

function cleanupScopedWorkflowVariables(workflowId, scopeId, internal, context) {
    if (!scopeId) return;

    const variables = internal
        ? context?.component?.workflowsResults?.[workflowId]?.variables
        : wwLib.store.data.workflowResultsById[workflowId]?.variables;

    if (!variables) return;

    for (const [actionId, variableData] of Object.entries(variables)) {
        if (variableData.scopeId === scopeId) {
            if (internal) {
                delete context.component.workflowsResults[workflowId].variables[actionId];
            } else {
                wwLib.store.data.deleteWorkflowVariable({ workflowId, actionId });
            }
        }
    }
}

export async function executeWorkflowActions(
    workflow,
    actionId,
    { context, event, callstack = [], isError, queue = [], executionContext, internal, returnResult, scopeId = null }
) {
    try {
        if (!workflow || !actionId) return {};
        const action = workflow.actions[actionId];
        if (!action) return {};

        // Each action may change workflows info, so we refetch new data on each iteration
        let localContext = {
            ...context,
            workflow: internal
                ? context?.component?.workflowsResults?.[workflow.id]
                : wwLib.store.data.workflowResultsById[workflow.id],
        };

        const { result, stop, breakLoop } = await executeWorkflowAction(workflow, actionId, {
            context: localContext,
            event,
            callstack,
            isError,
            standalone: false,
            executionContext,
            internal,
            returnResult,
            scopeId,
        });

        if (stop || breakLoop) {
            return { result, breakLoop, stop };
        }

        let branch = (action.branches || []).find(({ value }) => value === result);
        if (!branch) {
            branch = (action.branches || []).find(({ isDefault }) => isDefault);
        }
        if (branch && branch.id && !action.disabled) {
            const branchScopeId = `${workflow.id}_${actionId}_branch`;
            const branchResult = await executeWorkflowActions(workflow, branch.id, {
                context: localContext,
                event,
                callstack,
                isError,
                queue: action.next ? [action.next, ...queue] : queue,
                executionContext,
                internal,
                returnResult,
                scopeId: branchScopeId,
            });
            cleanupScopedWorkflowVariables(workflow.id, branchScopeId, internal, localContext);
            return branchResult;
        } else if (action.next) {
            return await executeWorkflowActions(workflow, action.next, {
                context: localContext,
                event,
                callstack,
                isError,
                queue,
                executionContext,
                internal,
                returnResult,
                scopeId,
            });
        } else if (queue.length) {
            return await executeWorkflowActions(workflow, queue[0], {
                context: localContext,
                event,
                callstack,
                isError,
                queue: queue.slice(1),
                executionContext,
                internal,
                returnResult,
                scopeId,
            });
        } else {
            return { result };
        }
    } catch (error) {
        // Stop the actions if one failed (legacy behavior)
        return { error };
    }
}

export async function executeWorkflowAction(
    workflow,
    actionId,
    {
        context = {},
        event = {},
        callstack = [],
        isError,
        standalone = true,
        executionContext,
        internal,
        fromFunction = false,
        returnResult,
        scopeId = null,
    }
) {
    let result, stop, breakLoop;
    if (!workflow || !actionId) return { result };

 
    if (!Object.keys(context).includes('workflow')) {
        context = {
            ...context,
            workflow: internal
                ? context?.component?.workflowsResults[workflow.id]
                : wwLib.store.data.workflowResultsById[workflow.id],
        };
    }

    const action = workflow.actions[actionId];
    if (!action) return { result };
    const workflowCapabilities = getFrontWorkflowCapabilities(workflow);
    const getValue = (rawValue, localContext = context, options = {}) =>
        _getValue(rawValue, localContext, {
            ...options,
            throwError: workflowCapabilities.throwOnConfigFormulaError,
        });

    function logActionInformation(type, log, meta = {}) {
        if (fromFunction) return;
     }

    if (!fromFunction) {
 
        if (!standalone && action.disabled) {
            return { result };
        }

     }

    const wwUtils = {
        log: logActionInformation,
    };

    const _actionType = action.type.split(':')[0];

    function getCreateVariableInitialValue(variableType, value) {
        if (value !== undefined) {
            return value;
        }

        switch (variableType) {
            case 'string':
                return '';
            case 'number':
                return 0;
            case 'boolean':
                return true;
            case 'array':
                return [];
            case 'object':
                return {};
            default:
                return value;
        }
    }

 
    function setResolvedConfig(path, value) {
         return value;
    }

    function resolveConfig(path, rawValue, localContext = context, options = {}) {
        return setResolvedConfig(path, getValue(rawValue, localContext, options));
    }

    try {
        switch (_actionType) {
            case 'custom-js': {
                if (!action.code) throw new Error('No custom code defined.');
                result = await executeCode(action.code, context, event, wwUtils);
                break;
            }
            case 'update-variable':
            case 'variable': {
                const returnFullValue = action.type === 'update-variable';
                if (!action.varId) throw new Error('No variable selected.');
                const value = resolveConfig('varValue', action.varValue, context, { event });
                const path = action.usePath
                    ? resolveConfig('path', action.path || '', context, { event, recursive: false })
                    : setResolvedConfig('path', null);
                const index = resolveConfig('index', action.index || 0, context, { event, recursive: false });

                if (workflow.actions[action.varId]?.type === 'create-variable') {
                    let currentVar;
                    if (internal) {
                        currentVar = context?.component?.workflowsResults?.[workflow.id]?.variables?.[action.varId];
                    } else {
                        currentVar = wwLib.store.data.workflowResultsById[workflow.id]?.variables?.[action.varId];
                    }
                    if (!currentVar) throw new Error('Workflow variable not found. Create it first.');

                    const newValue = applyVariableUpdate({ type: currentVar.type }, currentVar.value, value, {
                        path,
                        index,
                        arrayUpdateType: action.arrayUpdateType,
                    });

                    if (internal) {
                        set(
                            context.component,
                            `workflowsResults.${workflow.id}.variables.${action.varId}.value`,
                            newValue
                        );
                    } else {
                        wwLib.store.data.setWorkflowVariable({
                            workflowId: workflow.id,
                            actionId: action.varId,
                            value: newValue,
                            type: currentVar.type,
                            scopeId: currentVar.scopeId,
                        });
                    }
                    result = returnFullValue ? _.cloneDeep(newValue) : value;
                    break;
                }

                const variablesStore = wwLib.store.variables;
                const innerVariables =
                    wwLib.store.libraries.components[context?.component?.baseUid]?.inner?.variables || {};
                const innerComponentVariables = context?.component?.componentVariablesConfiguration || {};

                if (innerVariables[action.varId] || innerComponentVariables[action.varId]) {
                    result = _.cloneDeep(
                        context?.component?.methods?.updateVariable(action.varId, value, {
                            path,
                            index,
                            arrayUpdateType: action.arrayUpdateType,
                            workflowContext: { workflow, actionId: action.id, executionContext },
                        })
                    );
                } else if (variablesStore.getConfiguration(action.varId)) {
                    result = _.cloneDeep(
                        wwLib.wwVariable.updateValue(action.varId, value, {
                            path,
                            index,
                            arrayUpdateType: action.arrayUpdateType,
                            workflowContext: { workflow, actionId: action.id, executionContext },
                        })
                    );
                }

                break;
            }
            case 'reset-variables': {
                const variablesStore = wwLib.store.variables;
                const innerVariables =
                    wwLib.store.libraries.components[context?.component?.baseUid]?.inner?.variables || {};
                const innerComponentVariables = context?.component?.componentVariablesConfiguration || {};
                for (const varId of action.varsId || []) {
                    if (!varId) continue;
                    if (workflow.actions[varId]?.type === 'create-variable') {
                        const createAction = workflow.actions[varId];
                        const initialValue = getCreateVariableInitialValue(
                            createAction.variableType,
                            getValue(createAction.variableValue, context, { event, recursive: false })
                        );
                        if (internal) {
                            set(
                                context.component,
                                `workflowsResults.${workflow.id}.variables.${varId}.value`,
                                initialValue
                            );
                        } else {
                            const currentVar = wwLib.store.data.workflowResultsById[workflow.id]?.variables?.[varId];
                            if (currentVar) {
                                wwLib.store.data.setWorkflowVariable({
                                    workflowId: workflow.id,
                                    actionId: varId,
                                    value: initialValue,
                                    type: currentVar.type,
                                    scopeId: currentVar.scopeId,
                                });
                            }
                        }
                    } else {
                        const variable = variablesStore.getConfiguration(varId);
                        if (variable) {
                            wwLib.wwVariable.updateValue(
                                varId,
                                variable.defaultValue === undefined ? null : unref(variable.defaultValue),
                                { workflowContext: { workflow, actionId: action.id, executionContext } }
                            );
                        } else if (innerVariables[varId]) {
                            context?.component?.methods?.updateVariable(
                                varId,
                                innerVariables[varId].defaultValue === undefined
                                    ? null
                                    : unref(innerVariables[varId].defaultValue),
                                {
                                    workflowContext: { workflow, actionId: action.id, executionContext },
                                }
                            );
                        } else if (innerComponentVariables[varId]) {
                            context?.component?.methods?.updateVariable(
                                varId,
                                innerComponentVariables[varId].defaultValue === undefined
                                    ? null
                                    : unref(innerComponentVariables[varId].defaultValue),
                                {
                                    workflowContext: { workflow, actionId: action.id, executionContext },
                                }
                            );
                        }
                    }
                }
                break;
            }
            case 'create-variable': {
                if (!action.variableName) throw new Error('No variable name specified.');
                const value = getCreateVariableInitialValue(
                    action.variableType,
                    resolveConfig('variableValue', action.variableValue, context, { event })
                );

                if (internal) {
                    set(context.component, `workflowsResults.${workflow.id}.variables.${action.id}`, {
                        value,
                        type: action.variableType || 'string',
                        scopeId,
                    });
                } else {
                    wwLib.store.data.setWorkflowVariable({
                        workflowId: workflow.id,
                        actionId: action.id,
                        value,
                        type: action.variableType || 'string',
                        scopeId,
                    });
                }
                result = value;
                break;
            }
            case 'fetch-collection': {
                if (!action.collectionId) throw new Error('No collection selected.');
                const collection = wwLib.store.data.collections[action.collectionId] || {};
                if (!collection) throw new Error('Collection not found.');
                await wwLib.wwCollection.fetchCollection(
                    action.collectionId,
                    {},
                    { workflowContext: { workflow, actionId: action.id, executionContext } }
                );

                if (collection.error) {
                    if (collection.error.message) throw { name: 'Error', ...collection.error };
                    else throw new Error('Error while fetching the collection');
                }
                break;
            }
            case 'fetch-collections': {
                if (!action.collectionsId.length) throw new Error('No collection selected.');
                const collections = wwLib.store.data.collections;
                await Promise.all(
                    action.collectionsId
                        .filter(id => !!id)
                        .map(async collectionId => {
                            const collection = collections[collectionId];
                            if (!collection) throw new Error('Collection not found.');
                            await wwLib.wwCollection.fetchCollection(
                                collectionId,
                                {},
                                { workflowContext: { workflow, actionId: action.id, executionContext } }
                            );
                            if (collection.error) {
                                if (collection.error.message) throw { name: 'Error', ...collection.error };
                                else throw new Error(`Error while fetching the collection ${collection.name}`);
                            }
                        })
                );
                break;
            }
            case 'update-collection': {
                if (!action.collectionId) throw new Error('No collection selected.');
                const collection = wwLib.store.data.collections[action.collectionId];
                if (!collection) throw new Error('Collection not found.');
                const data = resolveConfig('data', action.data, context, { event });
                const updateIndex = resolveConfig('updateIndex', action.updateIndex, context, { event });
                const idKey = resolveConfig('idKey', action.idKey, context, { event });
                const idValue = resolveConfig('idValue', action.idValue, context, { event });
                const merge = resolveConfig('merge', action.merge, context, { event });
                const refreshFilter = resolveConfig('refreshFilter', action.refreshFilter, context, { event });
                const refreshSort = resolveConfig('refreshSort', action.refreshSort, context, { event });
                await wwLib.wwCollection.updateCollection(action.collectionId, data, {
                    updateType: action.updateType,
                    updateIndex,
                    updateBy: action.updateBy,
                    idKey,
                    idValue,
                    merge,
                    refreshFilter,
                    refreshSort,
                });
                break;
            }
            case 'fetch-table-view': {
                if (!action.tableViewId) throw new Error('No table view selected.');

                const backTableViewsStore = wwLib.store.backTableViews;
                const parameters = {
                    offset: resolveConfig('offset', action.offset, context, { event }),
                    limit: resolveConfig('limit', action.limit, context, { event }),
                    ...resolveConfig('parameters', action.parameters, context, { event }),
                };

                await backTableViewsStore.fetchData(action.tableViewId, {
                    parameters,
                    noLog: true,
                });
                break;
            }
            case 'fetch-table-view-offset': {
                if (!action.tableViewId) throw new Error('No table view selected.');

                const backTableViewsStore = wwLib.store.backTableViews;
                const parameters = {
                    ...backTableViewsStore.latestFetchParameters[action.tableViewId],
                    limit: resolveConfig('limit', action.limit, context, { event }),
                    offset: resolveConfig('offset', action.offset, context, { event }),
                };

                await backTableViewsStore.fetchData(action.tableViewId, {
                    parameters,
                    noLog: true,
                });
                break;
            }
            case 'fetch-table-view-load-more': {
                if (!action.tableViewId) throw new Error('No table view selected.');

                const backTableViewsStore = wwLib.store.backTableViews;
                await backTableViewsStore.fetchMore(action.tableViewId, {
                    group: resolveConfig('group', action.group, context, { event }),
                    parameters: {
                        limit: resolveConfig('limit', action.limit, context, { event }),
                    },
                    noLog: true,
                });
                break;
            }
            case 'change-page': {
                if (action.navigateMode === 'external') {
                    const externalUrl = resolveConfig('externalUrl', action.externalUrl, context, { event });

                     /* wwFront:start */
                    if (action.openInNewTab) wwLib.getFrontWindow().open(externalUrl, '_blank');
                    else wwLib.getFrontWindow().open(externalUrl, '_self');
                    /* wwFront:end */

                    break;
                }

                let href;
                let queries = {};

                if (action.mode === 'path') {
                    let path = resolveConfig('path', action.path, context, { event });
                    if (path !== '/' && path.endsWith('/')) path = path.replace(/\/$/, '');
                     /* wwFront:start */
                    href = path;
                    /* wwFront:end */
                } else {
                    if (!action.pageId) throw new Error('No page selected.');
                    const value = resolveConfig('pageId', action.pageId, context, { event });
                    const pageId = typeof value === 'object' ? value.id : value;
                    const page = wwLib.store.websiteData.pagesById[pageId];
                    if (!page) throw new Error('Page not found.');
                     /* wwFront:start */
                    href = wwLib.wwPageHelper.getPagePath(pageId);
                    /* wwFront:end */
                    const resolvedParameters = resolveConfig('parameters', action.parameters || {}, context, { event });
                    setResolvedConfig('parameters', resolvedParameters);
                    const variables = wwLib.store.data.resolvePageParameterVariables(pageId);
                     /* wwFront:start */
                    for (const variable of variables) {
                        href = href.replace(
                            `{{${variable.id}|${variable.defaultValue || ''}}}`,
                            resolvedParameters[variable.id]
                        );
                    }
                    /* wwFront:end */
                }

                const resolvedQueries = resolveConfig('queries', action.queries, context, { event });
                if (resolvedQueries) {
                    if (Array.isArray(resolvedQueries) && resolvedQueries.length)
                        queries = resolvedQueries.reduce((queries, query) => {
                            queries[query.name] = query.value;
                            return queries;
                        }, queries);
                    else if (typeof resolvedQueries === 'object') {
                        queries = { ...queries, ...resolvedQueries };
                    }
                }

                if (action.loadProgress && action.loadProgressColor) {
                    wwLib.store.front.setPageLoadProgress({ color: action.loadProgressColor });
                }
                const section = resolveConfig('section', action.section, context, { event });
                const hash = wwLib.wwUtils.sanitize(wwLib.store.websiteData.resolveSectionTitle(section) || section);
                wwLib.wwApp.goTo(href, queries, {
                    openInNewTab: action.openInNewTab,
                    hash: hash ? `#${hash}` : null,
                });
                break;
            }
            case 'previous-page': {
                let noBack;

                 noBack = !wwLib.getFrontRouter().options.history.state.back;

                if (noBack) {
                    let href;
                    if (!action.pageId) throw new Error('No page selected.');
                    const value = resolveConfig('pageId', action.pageId, context, { event });
                    const pageId = typeof value === 'object' ? value.id : value;
                    const page = wwLib.store.websiteData.pagesById[pageId];
                    if (!page) throw new Error('Page not found.');
                     /* wwFront:start */
                    href = wwLib.wwPageHelper.getPagePath(pageId);
                    /* wwFront:end */
                    wwLib.wwApp.goTo(href);
                    break;
                }

                 wwLib.getFrontRouter().go(-1);

                break;
            }
            case 'page-loader': {
                if (action.show) {
                    wwLib.store.front.setPageLoadProgress({ color: action.color || 'blue' });
                } else {
                    wwLib.store.front.setPageLoadProgress(false);
                }

                break;
            }
            case 'upload-file': {
                const variablesStore = wwLib.store.variables;
                if (!action.varId) throw new Error('No file variable selected.');

                const isVariable = typeof action.varId === 'string';
                const isInternalVariable =
                    isVariable && context?.component?.componentVariablesConfiguration?.[action.varId];

                const fileVariable = isVariable
                    ? isInternalVariable
                        ? context?.component?.componentVariablesConfiguration?.[action.varId]
                        : variablesStore.components[action.varId]
                    : null;
                const actionValue = isVariable
                    ? isInternalVariable
                        ? context?.component?.variables[action.varId]
                        : variablesStore.values[action.varId]
                    : resolveConfig('varId', action.varId, context, { event });

                if (isVariable) {
                    if (!fileVariable) throw new Error('File variable not found.');
                    if (!actionValue)
                        throw new Error(
                            'No file selected. Please create a true / false split to manage the case when there is no file.'
                        );
                } else {
                    if (!actionValue) throw new Error('File not found.');
                    if (typeof actionValue !== 'object') throw new Error('Not a file object.');
                }

                const progressVariable = isVariable
                    ? isInternalVariable
                        ? context?.component?.componentVariablesConfiguration?.[`${fileVariable.componentUid}-progress`]
                        : variablesStore.components[`${fileVariable.componentUid}-progress`]
                    : null;

                const statusVariable = isVariable
                    ? isInternalVariable
                        ? context?.component?.componentVariablesConfiguration?.[`${fileVariable.componentUid}-status`]
                        : variablesStore.components[`${fileVariable.componentUid}-status`]
                    : null;

                const element = isVariable ? wwLib.store.websiteData.wwObjects[fileVariable.componentUid] || {} : null;
                const isMultiple = isVariable
                    ? element?.content?.default?.multiple || statusVariable
                    : Array.isArray(actionValue);

                const updateProgressVariable = progress => {
                    if (!progressVariable) return;
                    if (isInternalVariable) {
                        context?.component?.methods?.updateVariable(`${fileVariable.componentUid}-progress`, progress);
                    } else {
                        variablesStore.setValue(progressVariable.id, progress);
                    }
                };

                const markAllFilesCompleted = () => {
                    if (!statusVariable) return;

                    const currentStatus = isInternalVariable
                        ? context?.component?.variables[`${fileVariable.componentUid}-status`] || {}
                        : variablesStore.values[statusVariable.id] || {};

                    const updatedStatus = { ...currentStatus };
                    for (const file of files) {
                        if (file && file.name) {
                            updatedStatus[file.name] = {
                                uploadProgress: 100,
                                isUploading: false,
                                isUploaded: true,
                            };
                        }
                    }

                    if (isInternalVariable) {
                        context?.component?.methods?.updateVariable(
                            `${fileVariable.componentUid}-status`,
                            updatedStatus
                        );
                    } else {
                        variablesStore.setValue(statusVariable.id, updatedStatus);
                    }
                };

                let progress = 0;
                result = [];

                const designId = wwLib.store.websiteData.designInfo.id;
                const files = isMultiple ? actionValue : [actionValue];
                let uploadClient = axios;
 
                for (const file of files) {
                    if (!file || !file.name) continue;

                    const { data } = await uploadClient.post(
                        `${wwLib.wwApiRequests._getApiUrl()}/designs/${designId}/user-files`,
                        {
                            name: file.name.replace(/[#!@$%^&*()+=\[\]{};':"\\|,<>\? \/]/g, '_'), // Replace problematic characters with underscores
                            type: file.type || file.mimeType,
                            size: file.size,
                            tag: `${
                                resolveConfig('fileTag', action.fileTag, context, {
                                    event,
                                    recursive: false,
                                }) || ''
                            }`,
                        }
                    );

                    const handleFileProgress = data => {
                        const fileProgress = (data.loaded / data.total) * 100;
                        const overallProgress = progress + fileProgress / files.length;

                        updateProgressVariable(overallProgress);

                        if (statusVariable) {
                            const fileId = file.name;
                            const currentStatus = isInternalVariable
                                ? context?.component?.variables[`${fileVariable.componentUid}-status`] || {}
                                : variablesStore.values[statusVariable.id] || {};

                            const updatedStatus = {
                                ...currentStatus,
                                [fileId]: {
                                    uploadProgress: fileProgress,
                                    isUploading: fileProgress < 100,
                                    isUploaded: fileProgress >= 100,
                                },
                            };

                            if (isInternalVariable) {
                                context?.component?.methods?.updateVariable(
                                    `${fileVariable.componentUid}-status`,
                                    updatedStatus
                                );
                            } else {
                                variablesStore.setValue(statusVariable.id, updatedStatus);
                            }
                        }
                    };

                    await axios.put(data.signedRequest, file, {
                        headers: { Accept: '*/*', 'Content-Type': file.type || file.mimeType },
                        skipAuthorization: true,
                        onUploadProgress: handleFileProgress,
                    });

                     result.push({ url: data.url, name: data.name, ext: data.ext, tag: data.tag, size: data.size });
                    progress += 100 / files.length;
                }
                if (!isMultiple) result = result[0];

                updateProgressVariable(100);
                markAllFilesCompleted();
                break;
            }
            case 'file-upload-url': {
                const variablesStore = wwLib.store.variables;
                if (!action.args.varId) throw new Error('No file variable selected.');

                const isVariable = typeof action.args.varId === 'string';
                const isMultiple = action.args._mode === 'multiple';
                const isInternalVariable =
                    isVariable && context?.component?.componentVariablesConfiguration?.[action.args.varId];
                const fileVariable = isVariable
                    ? isInternalVariable
                        ? context?.component?.componentVariablesConfiguration?.[action.args.varId]
                        : variablesStore.components[action.args.varId]
                    : null;
                const files = isVariable
                    ? isInternalVariable
                        ? context?.component?.variables[action.args.varId]
                        : variablesStore.values[action.args.varId]
                    : isMultiple
                      ? resolveConfig('args.varId', action.args.varId, context, { event })
                      : [resolveConfig('args.varId', action.args.varId, context, { event })];

                if (isVariable) {
                    if (!fileVariable) throw new Error('File Element not found.');
                    if (!files?.length)
                        throw new Error(
                            'No file selected. Please create a true / false split to manage the case when there is no file.'
                        );
                } else {
                    if (!files) throw new Error('File not found.');
                    if (typeof files !== 'object') throw new Error('Not a file object.');
                }

                const statusVariable = isVariable
                    ? isInternalVariable
                        ? context?.component?.componentVariablesConfiguration?.[`${fileVariable.componentUid}-status`]
                        : variablesStore.components[`${fileVariable.componentUid}-status`]
                    : null;

                const urls = isMultiple
                    ? resolveConfig('args.urls', action.args.urls, context, { event })
                    : { [files[0].name]: resolveConfig('args.url', action.args.url, context, { event }) };

                for (const file of files) {
                    if (!file || !file.name) throw new Error('File object is invalid.');

                    const handleFileProgress = data => {
                        const fileProgress = (data.loaded / data.total) * 100;

                        if (statusVariable) {
                            const fileId = file.name;
                            const currentStatus = isInternalVariable
                                ? context?.component?.variables[`${fileVariable.componentUid}-status`] || {}
                                : variablesStore.values[statusVariable.id] || {};

                            const updatedStatus = {
                                ...currentStatus,
                                [fileId]: {
                                    uploadProgress: fileProgress,
                                    isUploading: fileProgress < 100,
                                    isUploaded: fileProgress >= 100,
                                },
                            };

                            if (isInternalVariable) {
                                context?.component?.methods?.updateVariable(
                                    `${fileVariable.componentUid}-status`,
                                    updatedStatus
                                );
                            } else {
                                variablesStore.setValue(statusVariable.id, updatedStatus);
                            }
                        }
                    };

                    await axios.put(urls[file.name], file, {
                        headers: { Accept: '*/*', 'Content-Type': file.type || file.mimeType },
                        skipAuthorization: true,
                        onUploadProgress: handleFileProgress,
                    });

                    try {
                        await wwServerClient('/ww/storage/files/signed-url/upload/confirm', {
                            method: 'PATCH',
                            body: { signedUploadUrl: urls[file.name] },
                        });
                    } catch (error) {
                        if (error?.status !== 404) {
                            throw error;
                        }
                    }
                }

                break;
            }
            case 'execute-inner-workflow': {
                const _workflowId = action.type.split(':')?.[1] ?? action.workflowId;
                if (!_workflowId) throw new Error('No workflow selected.');

                const workflow =
                    wwLib.store.libraries.components[context?.component?.baseUid]?.inner?.workflows?.[_workflowId];
                const childExecutionContext = {
                    libraryComponentIdentifier: executionContext?.libraryComponentIdentifier,
                    parentExecutionId: executionContext?.executionId,
                };

                if (!workflow) throw new Error('Workflow not found.');

                const parameters = {};
                for (const paramName of Object.keys(action.parameters || {})) {
                    parameters[paramName] = getValue(action.parameters[paramName], context, { event });
                }
                setResolvedConfig('parameters', parameters);
                const execution = await executeWorkflow(workflow, {
                    context: {
                        ...context,
                        parameters,
                        workflow: context?.component?.workflowsResults?.[_workflowId] || {},
                    },
                    event,
                    callstack,
                    internal: true,
                    executionContext: childExecutionContext,
                });
                result = execution.result;
                if (execution.error) {
                    throw execution.error;
                }
                break;
            }
            case 'execute-workflow': {
                const _workflowId = action.type.split(':')?.[1] ?? action.workflowId;
                if (!_workflowId) throw new Error('No workflow selected.');

                let workflow;
                let childExecutionContext = {
                    parentExecutionId: executionContext?.executionId,
                };
                if (action.internal) {
                    workflow =
                        wwLib.store.libraries.components[context?.component?.baseUid]?.inner?.workflows?.[_workflowId];
                    childExecutionContext.libraryComponentIdentifier = executionContext?.libraryComponentIdentifier;
                } else {
                    workflow = wwLib.store.data.frontendWorkflows[_workflowId];
                }
                if (!workflow) throw new Error('Workflow not found.');

                const parameters = {};
                for (const paramName of Object.keys(action.parameters || {})) {
                    parameters[paramName] = getValue(action.parameters[paramName], context, { event });
                }
                setResolvedConfig('parameters', parameters);
                const execution = await executeWorkflow(workflow, {
                    context: {
                        ...context,
                        parameters,
                        workflow: action.internal
                            ? context?.component?.workflowsResults?.[_workflowId] || {}
                            : wwLib.store.data.workflowResultsById[_workflowId],
                    },
                    event,
                    callstack,
                    internal: action.internal,
                    executionContext: childExecutionContext,
                });
                result = execution.result;
                if (execution.error) {
                    throw execution.error;
                }
                break;
            }
            case 'execute-backend-workflow': {
                const workflowId = action.workflowId || action.type.split(':')[1];
                const inputData = resolveConfig('parameters', action.parameters || {}, context, { event });
                const options = resolveConfig('args', action.args || {}, context, { event });
                result = await executeBackendWorkflow(workflowId, inputData, options, context);
                break;
            }
            case 'trigger-event': {
                if (!action.triggerId) throw new Error('No trigger selected.');
                const trigger =
                    wwLib.store.libraries.components[context?.component?.baseUid]?.configuration?.triggers?.[
                        action.triggerId
                    ];
                const value = resolveConfig('event', action.event, context, { event, recursive: false });
                context?.component?.methods?.triggerEvent(action.triggerId, value);
                break;
            }
            case 'component-action': {
                if (!action.actionName) throw new Error('No actions selected.');

                const argsValues = resolveConfig('args', action.args, context, { event, recursive: true });
                result = executeComponentAction(
                    {
                        ...action,
                        repeatIndex: context?.item?.repeatIndex || null,
                    },
                    { context },
                    argsValues
                );

                break;
            }
            case 'execute-dropzone-workflow': {
                if (!action.workflowId) throw new Error('No workflow selected.');
                const parameters = resolveConfig('parameters', action.parameters, context, { event });
                const execution = await context?.dropzone?.methods?.executeWorkflow(action.workflowId, parameters, {
                    parentExecutionId: executionContext?.executionId,
                });
                result = execution.result;
                if (execution.error) {
                    throw execution.error;
                }
                break;
            }
            case 'return': {
                result = resolveConfig('value', action.value, context, { event });
                break;
            }
            case 'if': {
                result = !!resolveConfig('value', action.value, context, { event });
                break;
            }
            case 'switch': {
                result = resolveConfig('value', action.value, context, { event });
                break;
            }
            case 'filter': {
                result = !!resolveConfig('value', action.value, context, { event });
                stop = !result;
                break;
            }
            case 'wait': {
                if (action.value === undefined && action.duration === undefined)
                    throw new Error('No time delay defined.');
                const delay = resolveConfig('value', action.value || action.duration, context, { event });
                await new Promise(resolve => setTimeout(resolve, delay));
                break;
            }
            case 'return-result': {
                stop = !resolveConfig('args.continueWorkflow', action.args?.continueWorkflow, context, { event });
                result = resolveConfig('args.data', action.args?.data, context, { event });
                returnResult({ result });
                break;
            }
            case 'throw': {
                const { message, cause } = resolveConfig('args', action.args, context, { event });
                throw new Error(message, { cause });
            }
            case 'trycatch': {
                const branches = action.branches.reduce((acc, branch) => {
                    acc[branch.value] = branch.id;
                    return acc;
                }, {});
                result = { caughtError: null };
                const tryScopeId = `${workflow.id}_${actionId}_try`;
                const catchScopeId = `${workflow.id}_${actionId}_catch`;
                const finallyScopeId = `${workflow.id}_${actionId}_finally`;
                let branchStop = false;
                // Persist the try/catch result (incl. caughtError) before running the catch/finally
                // branches, so their actions can read context.workflow[actionId].result.caughtError.
                // Without this, the result is only written after the whole switch completes (below),
                // i.e. too late for the branches that run inside this case.
                const persistTryCatchResult = () => {
                    if (internal) {
                        set(context.component, `workflowsResults.${workflow.id}.${actionId}.result`, result);
                    } else {
                        wwLib.store.data.setWorkflowActionResult({
                            workflowId: workflow.id,
                            actionId,
                            result,
                            error: null,
                        });
                    }
                };
                try {
                    const { error: tryError, stop: tryStop } = await executeWorkflowActions(workflow, branches.try, {
                        isError,
                        context,
                        event,
                        callstack,
                        executionContext,
                        internal,
                        returnResult,
                        scopeId: tryScopeId,
                    });
                    cleanupScopedWorkflowVariables(workflow.id, tryScopeId, internal, context);
                    if (tryStop) branchStop = true;
                    if (tryError) {
                        result.caughtError = { name: tryError.name, message: tryError.message, cause: tryError.cause };
                        throw tryError;
                    }
                } catch (error) {
                    cleanupScopedWorkflowVariables(workflow.id, tryScopeId, internal, context);
                    persistTryCatchResult();
                    if (branches.catch) {
                        const { error: catchError, stop: catchStop } = await executeWorkflowActions(
                            workflow,
                            branches.catch,
                            {
                                isError,
                                context,
                                event,
                                callstack,
                                executionContext,
                                internal,
                                returnResult,
                                scopeId: catchScopeId,
                            }
                        );
                        cleanupScopedWorkflowVariables(workflow.id, catchScopeId, internal, context);
                        if (catchStop) branchStop = true;
                        if (catchError) throw catchError;
                    }
                } finally {
                    if (branches.finally) {
                        persistTryCatchResult();
                        const { stop: finallyStop } = await executeWorkflowActions(workflow, branches.finally, {
                            isError,
                            context,
                            event,
                            callstack,
                            executionContext,
                            internal,
                            returnResult,
                            scopeId: finallyScopeId,
                        });
                        cleanupScopedWorkflowVariables(workflow.id, finallyScopeId, internal, context);
                        if (finallyStop) branchStop = true;
                    }
                }
                stop = branchStop;
                break;
            }
            case 'user-location': {
                if (!('geolocation' in navigator)) {
                    logActionInformation('error', 'Geolocation is not available.');
                    throw new Error('Geolocation is not available.');
                }

                try {
                    const response = await new Promise((resolve, reject) => {
                        navigator.geolocation.getCurrentPosition(resolve, reject);
                    });

                    result = {
                        coords: {
                            accuracy: response.coords.accuracy,
                            altitude: response.coords.altitude,
                            altitudeAccuracy: response.coords.altitudeAccuracy,
                            heading: response.coords.heading,
                            latitude: response.coords.latitude,
                            longitude: response.coords.longitude,
                            speed: response.coords.speed,
                        },
                        timestamp: response.timestamp,
                    };
                } catch (error) {
                    throw new Error('Error while geolocation.');
                }

                break;
            }
            case 'print-pdf': {
                wwLib.getFrontWindow().print();

                break;
            }
            case 'download-csv': {
                const data = resolveConfig('data', action.data, context, { event });
                const fileName = resolveConfig('fileName', action.fileName, context, { event }) || 'data.csv';

                if (!Array.isArray(data) || data.length === 0) {
                    throw new Error('Data must be a non-empty array');
                }

                const escapeCSV = value => {
                    if (value === null || value === undefined) return '';
                    const stringValue = String(value);
                    if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
                        return `"${stringValue.replace(/"/g, '""')}"`;
                    }
                    return stringValue;
                };

                const headers = [...new Set(data.flatMap(item => Object.keys(item)))];
                const csvRows = [
                    headers.map(escapeCSV).join(','),
                    ...data.map(row =>
                        headers.map(header => escapeCSV(getValue(row[header], context, { event }))).join(',')
                    ),
                ];
                const csvContent = csvRows.join('\n');

                const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.setAttribute('href', url);
                link.setAttribute('download', fileName.endsWith('.csv') ? fileName : `${fileName}.csv`);
                link.style.visibility = 'hidden';
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                URL.revokeObjectURL(url);

                break;
            }
            case 'loop': {
                let items = resolveConfig('value', action.value, context, { event });
                if (!Array.isArray(items)) {
                    throw new Error('Fail to start loop, as items to parse is not iterable');
                }
                for (const [index, item] of items.entries()) {
                    const loopScopeId = `${workflow.id}_${actionId}_loop_${index}`;
                    if (internal) {
                        set(context.component, `workflowsResults.${workflow.id}.${actionId}.loop`, {
                            index,
                            item,
                            items,
                        });
                    } else {
                        wwLib.store.data.setWorkflowActionLoop({
                            workflowId: workflow.id,
                            actionId,
                            loop: {
                                index,
                                item,
                                items,
                            },
                        });
                    }
                    const {
                        error: loopError,
                        result: loopResult,
                        breakLoop: loopBrealLoop,
                    } = await executeWorkflowActions(workflow, action.loop, {
                        isError,
                        context,
                        event,
                        callstack,
                        executionContext,
                        internal,
                        scopeId: loopScopeId,
                    });
                    cleanupScopedWorkflowVariables(workflow.id, loopScopeId, internal, context);
                    if (loopError) {
                        throw loopError;
                    }
                    result = loopResult;
                    if (loopBrealLoop) {
                        break;
                    }
                }
                break;
            }
            case 'while-loop': {
                let value = resolveConfig('value', action.value, context, { event });
                let whileIndex = 0;
                while (value) {
                    const whileScopeId = `${workflow.id}_${actionId}_while_${whileIndex}`;
                    const {
                        error: loopError,
                        result: loopResult,
                        breakLoop: loopBrealLoop,
                    } = await executeWorkflowActions(workflow, action.loop, {
                        isError,
                        context,
                        event,
                        callstack,
                        executionContext,
                        internal,
                        scopeId: whileScopeId,
                    });
                    cleanupScopedWorkflowVariables(workflow.id, whileScopeId, internal, context);
                    result = loopResult;
                    if (loopError) {
                        throw loopError;
                    }
                    if (loopBrealLoop) {
                        break;
                    }
                    whileIndex++;
                    // Each action may change workflows info, so we refetch new data on each iteration
                    let localContext = {
                        ...context,
                        workflow: internal
                            ? context?.component?.workflowsResults?.[workflow.id]
                            : wwLib.store.data.workflowResultsById[workflow.id],
                    };
                    value = resolveConfig('value', action.value, localContext, { event });
                }
                break;
            }
            case 'continue-loop': {
                result = stop = resolveConfig('value', action.value, context, { event });
                break;
            }
            case 'break-loop': {
                result = breakLoop = resolveConfig('value', action.value, context, { event });
                break;
            }
            case 'change-lang': {
                if (!action.lang) throw new Error('No language selected.');
                const lang = resolveConfig('lang', action.lang, context, { event });

                const setLangSuccess = wwLib.wwLang.setLang(lang);
                if (!setLangSuccess) throw new Error(`Page does not contain the lang "${lang}"`);

                break;
            }
            case 'log': {
                 break;
            }
            case 'copy-clipboard': {
                result = resolveConfig('value', action.value, context, { event });
                // Preview clicks focus the canvas iframe, so use its clipboard instead of the editor document.
                const frontWindow = wwLib.getFrontWindow();
                try {
                    await frontWindow.navigator.clipboard.writeText(`${result}`);
                } catch (error) {
                     throw error;
                }
                break;
            }
            case 'share': {
                const title = resolveConfig('title', action.title, context, { event });
                const text = resolveConfig('text', action.text, context, { event });
                const url = resolveConfig('url', action.url, context, { event });

                if (!navigator.share) throw new Error('Share is not available on this device');

                const shareData = { title, url };
                if (text) shareData.text = text;

                if (navigator.canShare && !navigator.canShare(shareData)) {
                    throw new Error('The provided data cannot be shared');
                }

                await navigator.share(shareData);
                break;
            }
            case 'vibrate': {
                const pattern = resolveConfig('pattern', action.pattern, context, { event });

                if (!navigator.vibrate) throw new Error('Vibration is not available on this device');
                if (!Array.isArray(pattern) || pattern.length === 0) {
                    throw new Error('Vibration pattern must be a non-empty array');
                }

                navigator.vibrate(pattern);
                break;
            }
            case 'show-notification': {
                const title = resolveConfig('title', action.title, context, { event });
                const body = resolveConfig('body', action.body, context, { event });
                const icon = resolveConfig('icon', action.icon, context, { event });
                const image = resolveConfig('image', action.image, context, { event });
                const tag = resolveConfig('tag', action.tag, context, { event });
                const data = resolveConfig('data', action.data, context, { event });
                const vibrate = resolveConfig('vibrate', action.vibrate, context, { event });

                if (!('Notification' in window)) throw new Error('Notifications are not available');

                const permission = await Notification.requestPermission();
                if (permission !== 'granted') throw new Error('Notification permission denied');

                const registration = await navigator.serviceWorker?.getRegistration();
                if (registration) {
                    const options = {};
                    if (body) options.body = body;
                    if (icon) options.icon = icon;
                    if (image) options.image = image;
                    if (tag) options.tag = tag;
                    if (data) options.data = data;
                    if (vibrate) options.vibrate = vibrate;
                    registration.showNotification(title, options);
                } else {
                    new Notification(title, { body, icon, image, tag });
                }
                break;
            }
            case 'install-pwa': {
                if (!wwLib.installPwaPrompt) throw new Error('Install prompt not available');
                await wwLib.installPwaPrompt.prompt();
                break;
            }
            case 'stop-click': {
                event?.stopPropagation?.();
                event?.preventDefault?.();
                break;
            }
            case 'stop-propagation': {
                event?.stopPropagation?.();
                break;
            }
            case 'file-create-url': {
                const base64String = resolveConfig('fileString', action.fileString, context, { event });
                // Decode the Base64 string into a Uint8Array
                const binaryString = atob(
                    base64String.startsWith('data:') ? base64String.split('base64,')[1] : base64String
                );
                const arrayBuffer = new ArrayBuffer(binaryString.length);
                const uint8Array = new Uint8Array(arrayBuffer);
                for (let i = 0; i < binaryString.length; i++) {
                    uint8Array[i] = binaryString.charCodeAt(i);
                }

                // Create a Blob from the Uint8Array
                const blob = new Blob([uint8Array], { type: 'application/octet-stream' });

                // Generate a URL for the Blob
                const blobUrl = URL.createObjectURL(blob);
                result = blobUrl;
                break;
            }
            case 'file-encode-base64': {
                const variablesStore = wwLib.store.variables;
                let file;
                if (typeof action.file === 'string') {
                    const innerComponentVariables = context?.component?.componentVariablesConfiguration || {};
                    if (innerComponentVariables[action.file]) {
                        file = context?.component?.variables?.[action.file];
                    } else {
                        file = variablesStore.values[action.file];
                    }
                } else {
                    file = resolveConfig('file', action.file, context, { event });
                }
                if (!file) throw new Error('File not found.');
                if (typeof file !== 'object') throw new Error('Not a file object.');

                result = await new Promise(resolve => {
                    const reader = new FileReader();
                    reader.onload = () =>
                        resolve(action.output === 'base64' ? reader.result.split(',')[1] : reader.result);

                    reader.readAsDataURL(file);
                });
                if (!result)
                    throw new Error(
                        'Cannot encode the file. Your file may be too big to be encoded to base64 in a browser (Chrome-like=512mb;Firefox=32mb).'
                    );
                break;
            }
            case 'file-download-url': {
                const res = await fetch(resolveConfig('fileUrl', action.fileUrl, context, { event }));
                if (!res.ok) {
                    const error = await res.text();
                    throw new Error('File could not be fetch', { cause: error });
                }
                const blob = await res.blob();

                // Create a URL for the Blob object
                const blobUrl = URL.createObjectURL(blob);

                // Sanitize and validate the file name
                let fileName = resolveConfig('fileName', action.fileName, context, { event }) || '';
                fileName = fileName.replace(/[^\w\s.-]/gi, '');

                if (blobUrl.startsWith('blob:')) {
                    // Create a link element for downloading the file
                    const downloadLink = wwLib.getFrontDocument().createElement('a');

                    // Set the download attributes with sanitized values
                    downloadLink.href = blobUrl;
                    downloadLink.download = fileName;

                    // Simulate a click on the link to trigger the download
                    downloadLink.click();
                } else {
                    throw new Error('Invalid blob URL');
                }

                // Clean up by revoking the Blob URL
                URL.revokeObjectURL(blobUrl);
                break;
            }
            case 'change-theme': {
                let theme = resolveConfig('theme', action.theme, context, { event }) || 'light';

                if (theme === 'toggle') {
                    const currentTheme = wwLib.store.front.resolvedTheme;
                    if (currentTheme === 'light') {
                        theme = 'dark';
                    } else if (currentTheme === 'dark') {
                        theme = 'light';
                    }
                }

                if (theme !== 'light' && theme !== 'dark') {
                    theme = 'light';
                }

                wwLib.store.front.setTheme(theme);
                break;
            }
            case 'open-popup': {
                const _action = JSON.parse(JSON.stringify(action));

                const modalsStore = wwLib.store.popups;

                // AI Fix : AI sometimes use the label as the key of the popup properties
                const popup = wwLib.store.libraries.components?.[_action.libraryComponentBaseId];
                const popupProperties = popup?.configuration?.properties || {};

                for (const key in _action.content?.default || {}) {
                    if (Object.keys(popupProperties).includes(key)) continue;
                    else {
                        const propByLabel = Object.values(popupProperties).find(prop => prop.label === key);
                        if (propByLabel) {
                            _action.content.default[propByLabel.id] = _action.content.default[key];
                        }
                    }
                }

                result = await modalsStore.open(
                    _action.libraryComponentBaseId,
                    resolveConfig('content', _action.content, context, { event }),
                    {
                        waitClosing: _action.waitClosing,
                    }
                );
                break;
            }
            case 'close-popup': {
                await context.local?.methods.popup.close.method(resolveConfig('data', action.data, context, { event }));
                break;
            }
            case 'close-all-popup': {
                const modalsStore = wwLib.store.popups;
                modalsStore.closeAll(action.libraryComponentBaseId);
                break;
            }
            case 'http-request': {
                const args = resolveConfig('args', action.args || {}, context, { event });

                try {
                    result = await betterFetch(args.url, {
                        method: args.method || 'GET',
                        body: args.body,
                        query: args.query,
                        params: args.params,
                        credentials: args.credentials,
                        auth: {
                            type: args.auth?.type,
                            username: args.auth?.username,
                            password: args.auth?.password,
                            token: args.auth?.token,
                        },
                        headers: args.headers,
                        retry: {
                            type: args.retry?.type || 'linear',
                            attempts: args.retry?.attempts || 0,
                            delay: args.retry?.delay || 0,
                            baseDelay: args.retry?.baseDelay || 0,
                            maxDelay: args.retry?.maxDelay,
                        },
                        throw: true,
                        timeout: args.timeout,
                        cache: args.cache,
                        keepalive: args.keepAlive,
                        mode: args.mode,
                        priority: args.priority,
                    });
                } catch (error) {
                    error.data = error?.error;
                    delete error.error;
                    delete error.cause;
                    throw error;
                }

                break;
            }
            default: {
                if (action.type.includes('/')) {
                    const [integration, actionName] = action.type.split('/');
                    const integrationsStore = wwLib.store.integrations;
                    const backAuthStore = wwLib.store.backAuth;

                    if (!action.connectionId && integration === backAuthStore.authIntegration) {
                        action.connectionId = backAuthStore.connectionId;
                    }
                     result = await integrationsCore[integration]?.actions?.[actionName](
                        { args: resolveConfig('args', action.args, context, { event }) },
                        {
                            connection: integrationsStore.getConnection(action.connectionId),
                            instance: integrationsStore.getInstance(action.connectionId || integration),
                            context,
                        }
                    );
                } else if (action.type.startsWith('_wwLocalMethod_')) {
                    const match = action.type.match(/_wwLocalMethod_(.+)\.(.+)/);
                    if (match) {
                        const [, elementKey, methodKey] = match;
                        const method = context.local?.methods?.[elementKey]?.[methodKey]?.method;

                        if (typeof method === 'function') {
                            const args = (action.args || []).map(arg => getValue(arg, context, { event }));
                            setResolvedConfig('args', args);
                            result = method(...args);
                        }
                    }
                } else {
                    const actions = wwLib.store.data.pluginActions;
                    const currentAction = actions[action.type];
                    if (!currentAction) break;
                    const plugin =
                        currentAction.pluginId && wwLib.store.websiteData.pluginsById[currentAction.pluginId];
                    if (!plugin) break;
                    const args = resolveConfig('args', action.args || [], context, { event });
                    try {
                        const promise = wwLib.wwPlugins[plugin.namespace][currentAction.code](args, wwUtils);
                        result = currentAction.isAsync ? await promise : promise;
                    } catch (error) {
                        wwLib.wwLog.error(error);
                        throw error;
                    }
                }

                break;
            }
        }

        // Generic stream handling
        if (
            action.args?.__wwstream === true &&
            result &&
            typeof result === 'object' &&
            Symbol.asyncIterator in result
        ) {
            const chunks = [];

            if (internal) {
                set(context.component, `workflowsResults.${workflow.id}.${actionId}.stream`, {
                    chunks: [],
                    chunk: null,
                });
            } else {
                wwLib.store.data.setWorkflowActionStream({
                    workflowId: workflow.id,
                    actionId,
                    stream: {
                        chunks: [],
                        chunk: null,
                    },
                });
            }

            for await (const parsedChunk of parseSSEStreamAsync(result)) {
                chunks.push(parsedChunk);

                if (internal) {
                    set(context.component, `workflowsResults.${workflow.id}.${actionId}.stream.chunks`, chunks);
                    set(context.component, `workflowsResults.${workflow.id}.${actionId}.stream.chunk`, parsedChunk);
                } else {
                    wwLib.store.data.setWorkflowActionStream({
                        workflowId: workflow.id,
                        actionId,
                        stream: {
                            chunk: parsedChunk,
                            chunks,
                        },
                    });
                }

                if (action.loop) {
                    await executeWorkflowActions(workflow, action.loop, {
                        isError,
                        context: { ...context, chunk: parsedChunk },
                        event,
                        callstack,
                        executionContext,
                        internal,
                        returnResult,
                    });
                }
            }
            result = chunks;
        }

        if (!fromFunction) {
            if (internal) {
                set(context.component, `workflowsResults.${workflow.id}.${actionId}.result`, result);
                set(context.component, `workflowsResults.${workflow.id}.${actionId}.error`, null);
             } else {
                wwLib.store.data.setWorkflowActionResult({
                    workflowId: workflow.id,
                    actionId,
                    result,
                    error: null,
                 });
            }

         }
    } catch (err) {
        const error = convertErrorToObject(err);

        if (!fromFunction) {
            if (internal) {
                set(context.component, `workflowsResults.${workflow.id}.${actionId}.error`, error);
                set(context.component, `workflowsResults.${workflow.id}.${actionId}.result`, result);
             } else {
                wwLib.store.data.setWorkflowActionResult({
                    workflowId: workflow.id,
                    actionId,
                    error,
                    result,
                 });
            }

         }
        throw err;
    }

    return { result, stop, breakLoop };
}

export async function executeWorkflowActionAsFunction(type, params = {}, context = {}) {
    const workflow = {
        id: 'wf_id',
        firstActionId: 'action_id',
        trigger: null,
        actions: {
            action_id: {
                id: 'action_id',
                type,
                next: null,
                ...params,
            },
        },
    };
    const { result } = await executeWorkflowAction(workflow, 'action_id', { context, fromFunction: true });
    return result;
}

export const workflowFunctions = {
    //Variables
    /* Params:
        - varIds: Array of variable ids to reset
    */
    resetVariablesValues: async varIds => {
        return await executeWorkflowActionAsFunction('reset-variables', { varIds });
    },

    //Collections
    /* Params:
        - collectionId: string, Id of the collection to fetch
    */
    fetchCollection: async collectionId => {
        return await executeWorkflowActionAsFunction('fetch-collection', { collectionId });
    },
    /* Params:
        - collectionIds: Array of collection ids to fetch
    */
    fetchCollectionsInParallel: async collectionsId => {
        return await executeWorkflowActionAsFunction('fetch-collections', { collectionsId });
    },

    //Page
    /* Params:
        - navigateMode: 'internal' or 'external'
        - mode: 'page' | 'path' (only for internal navigation)
        - pageId: string, Id of the page to navigate to (only for internal navigation and mode = 'page')
        - path: string, Path of the page to navigate to (only for internal navigation and mode = 'path')
        - externalUrl: string, External URL to navigate to (only for external navigation)
        - section: string, Id of the section to navigate to (only for internal navigation)
        - openInNewTab: boolean, Open the page in a new tab
        - queries: array of queries to pass to the page: `[{"name": "queryName", "value": "queryValue"}]` (only for internal navigation)
        - loadProgress: boolean, Show the loading progress bar (only for internal navigation)
        - loadProgressColor: string, Color of the loading progress bar (only for internal navigation)
    */
    goToPage: async (
        navigateMode,
        { mode, pageId, path, externalUrl, section, openInNewTab, queries, loadProgress, loadProgressColor }
    ) => {
        return await executeWorkflowActionAsFunction('change-page', {
            navigateMode,
            mode,
            pageId,
            path,
            externalUrl,
            section,
            openInNewTab,
            queries,
            loadProgress,
            loadProgressColor,
        });
    },
    /* Params:
        - pageId: string, Id of the default page to return to if no previous page in the navigation
    */
    goToPreviousPage: async pageId => {
        return await executeWorkflowActionAsFunction('previous-page', { pageId });
    },
    /* Params:
        - show: boolean, Show or hide the loading progress bar
        - color: string, Color of the loading progress bar
    */
    setPageLoader: async (show, color) => {
        return await executeWorkflowActionAsFunction('page-loader', { show, color });
    },
    /* Params:
        - theme: 'light' | 'dark'
    */
    setTheme: async theme => {
        return await executeWorkflowActionAsFunction('change-theme', { theme });
    },
    /* Params:
        - lang: string, Language to change to. Must be 2 chars long.
    */
    setLang: async lang => {
        return await executeWorkflowActionAsFunction('change-lang', { lang });
    },

    //Files
    /* Params: none */
    printPdf: async () => {
        return await executeWorkflowActionAsFunction('print-pdf');
    },
    /* Params:
        - fileString: string, Base64 string of the file to create a URL from
    */
    createUrlFromBase64: async fileString => {
        return await executeWorkflowActionAsFunction('file-create-url', { fileString });
    },
    /* Params:
        - file: string, uid of the element that contains the file to encode
        - output: 'base64' | 'dataUrl'
    */
    encodeFileBase64: async (file, output) => {
        return await executeWorkflowActionAsFunction('file-encode-base64', { file, output });
    },
    /* Params:
        - fileUrl: string, URL of the file to download
        - fileName: string, Name of the file to download
    */
    downloadFileFromUrl: async (fileUrl, fileName) => {
        return await executeWorkflowActionAsFunction('file-download-url', { fileUrl, fileName });
    },
    /* Params:
        - varId: string, uid of the element that contains the file to upload
        - fileTag: string, Tag that will be added to the file in WeWeb
    */
    uploadFileToWeWeb: async (varId, fileTag) => {
        return await executeWorkflowActionAsFunction('upload-file', { varId, fileTag });
    },

    openPopup: async (libraryComponentBaseId, params) => {
        // Check if the libraryComponentBaseId is a popup (libraryComponentBaseId of type 'modal'), otherwise use its parentLibraryComponentId
        const element = wwLib.store.websiteData.wwObjects?.[libraryComponentBaseId];
        if (element?.parentLibraryComponentId) {
            libraryComponentBaseId = element.parentLibraryComponentId;
        }

        return await executeWorkflowActionAsFunction('open-popup', {
            libraryComponentBaseId,
            content: { default: params },
        });
    },

    closePopup: async (context, data) => {
        return await context.local.methods.popup.close.method(data);
    },

    //Workflows and Elements
    /* Params:
        - ...args: List of args of the function

       Use workflowId as key to call the function
       Example: executeGlobalFunction[workflowId](arg1, arg2, ...)
    */
    executeGlobalFunction: new Proxy(
        {},
        {
            get(_target, workflowId) {
                return async (...args) => {
                    const globalWorkflow = wwLib.store.data.frontendWorkflows[workflowId];
                    if (!globalWorkflow) {
                         throw new Error(`Global workflow "${workflowId}" not found.`);
                    }
                    const globalWorkflowParameters = globalWorkflow.parameters || [];
                    const parameters = {};
                    for (const i in args) {
                        if (globalWorkflow.parameters[i]?.name) {
                            parameters[globalWorkflow.parameters[i].name] = args[i];
                        }
                    }
                    return await executeWorkflowActionAsFunction('execute-workflow', { workflowId, parameters });
                };
            },
        }
    ),

    executePopupFunction: context => {
        // Return the proxy of the context
        return new Proxy(
            {},
            {
                get(_target, workflowId) {
                    return async (...args) => {
                        // Get popup library component
                        const libraryComponent = Object.values(wwLib.store.libraries.components)?.find(
                            e => e.id == context.component.baseUid && e.type == 'modal'
                        );
                        if (!libraryComponent)
                            throw new Error(`Library component "${context.component.baseUid}" not found.`);

                        // Get popup workflow
                        const popupWorkflow = libraryComponent.inner.workflows?.[workflowId];
                        if (!popupWorkflow) {
                             throw new Error(`Popup workflow "${workflowId}" not found.`);
                        }

                        const parameters = {};
                        for (const i in args) {
                            if (popupWorkflow.parameters[i]?.name) {
                                parameters[popupWorkflow.parameters[i].name] = args[i];
                            }
                        }
                        return await executeWorkflowActionAsFunction(
                            'execute-workflow',
                            { workflowId, parameters, internal: true },
                            context
                        );
                    };
                },
            }
        );
    },

    /* Params:
        - uid: string, uid of the element
        - actionName: string, name of the action to execute
        - args: array, Arguments to pass to the element action: `[true, "example"]`
    */
    executeElementAction: async (uid, actionName, args) => {
        return await executeWorkflowActionAsFunction('component-action', { uid, actionName, args });
    },

    //Plugins
    /* Params:
        - pluginId: string, uid of the plugin
        - functionName: string, name of the function to execute
        - args: array, Arguments to pass to the function: `{"param1": "value1", "param2": "value2"}`
    */
    executePluginFunction: async (pluginId, functionName, args) => {
        return await executeWorkflowActionAsFunction(`${pluginId}-${functionName}`, { args });
    },

    //Backend
    fetchTableView: async (tableViewId, parameters = [], offset = 0) => {
        return await executeWorkflowActionAsFunction('fetch-table-view', { tableViewId, parameters, offset });
    },

    executeBackendWorkflow: async (workflowId, parameters = []) => {
        return await executeWorkflowActionAsFunction(`execute-backend-workflow:${workflowId}`, { parameters });
    },

    //Auth backend
    authSignInWithEmail: async (email, password, rememberMe) => {
        return await executeWorkflowActionAsFunction('auth-signin-email', { email, password, rememberMe });
    },
    authSignInWithSocial: async (provider, callbackURL, errorCallbackURL, newUserCallbackURL, disableRedirect) => {
        return await executeWorkflowActionAsFunction('auth-signin-social', {
            provider,
            callbackURL,
            errorCallbackURL,
            newUserCallbackURL,
            disableRedirect,
        });
    },
    authSignOut: async () => {
        return await executeWorkflowActionAsFunction('auth-signout');
    },
    authVerifyEmail: async (email, redirectURL) => {
        return await executeWorkflowActionAsFunction('auth-verify-email', { email, redirectURL });
    },
    authRequestMagicLink: async (email, name, callbackURL, newUserCallbackURL, errorCallbackURL) => {
        return await executeWorkflowActionAsFunction('auth-request-magic-link', {
            email,
            name,
            callbackURL,
            newUserCallbackURL,
            errorCallbackURL,
        });
    },
    authRequestOTP: async (email, type) => {
        return await executeWorkflowActionAsFunction('auth-request-otp', { email, type });
    },
    authCheckVerificationOTP: async (email, otp, type) => {
        return await executeWorkflowActionAsFunction('auth-check-verification-otp', { email, otp, type });
    },
    authSignInOTP: async (email, otp) => {
        return await executeWorkflowActionAsFunction('auth-signin-otp', { email, otp });
    },
    authSignUpOTP: async (email, otp, disableSignIn) => {
        return await executeWorkflowActionAsFunction('auth-signup-otp', { email, otp, disableSignIn });
    },
    authResetPasswordOTP: async (email, otp, password) => {
        return await executeWorkflowActionAsFunction('auth-reset-password-otp', { email, otp, password });
    },
    authVerifyEmailOTP: async (email, otp) => {
        return await executeWorkflowActionAsFunction('auth-verify-email-otp', { email, otp });
    },
    authResetPassword: async (email, password) => {
        return await executeWorkflowActionAsFunction('auth-reset-password', { email, password });
    },
    authSignUp: async (email, password, name, image, callbackURL) => {
        return await executeWorkflowActionAsFunction('auth-signup', { email, password, name, image, callbackURL });
    },
    authSignIn: async (email, password, rememberMe) => {
        return await executeWorkflowActionAsFunction('auth-signin', { email, password, rememberMe });
    },
};

export function convertErrorToObject(err) {
    const keys = ['name', ...Object.getOwnPropertyNames(err)];
    let error = {};
    for (const key of keys) error[key] = err[key];
    return error;
}

function getPageUrl(pageConfig = {}) {
    if (pageConfig.type === 'internal') {
        const pageId = pageConfig.pageId;
        return wwLib.manager
            ? `${window.location.origin}/${pageId}`
            : `${window.location.origin}${wwLib.wwPageHelper.getPagePath(pageId)}`;
    } else {
        return pageConfig.url;
    }
}
