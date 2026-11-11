import { shallowReactive, reactive, ref } from 'vue';
import { defineStore } from 'pinia';
import { loadTableView } from '@/_common/helpers/code/tablesViews.js';

 
const regexUid = /^[0-9a-f]{8}\b-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-\b[0-9a-f]{12}$/;

function getPublicResultShape(tableViewData, isGrouped = false) {
    if (tableViewData?.kind === 'rows') {
        return { rows: tableViewData.rows ?? [] };
    }
    if (tableViewData?.kind === 'groups' || isGrouped) {
        return { groups: tableViewData?.groups ?? [] };
    }
    return { data: tableViewData?.data ?? [] };
}

function getResultItems(tableViewData) {
    return tableViewData?.groups ?? tableViewData?.rows ?? tableViewData?.data ?? [];
}

function appendResultPage(currentItems, newData) {
    if (newData?.kind === 'groups') {
        return { ...newData, groups: [...currentItems, ...(newData.groups ?? [])] };
    }
    if (newData?.kind === 'rows') {
        return { ...newData, rows: [...currentItems, ...(newData.rows ?? [])] };
    }
    return { ...newData, data: [...currentItems, ...(newData?.data ?? [])] };
}

function findGroup(groups, groupId) {
    for (const group of groups || []) {
        if (group?.id === groupId) return group;
        const child = findGroup(group?.children, groupId);
        if (child) return child;
    }
    return null;
}

export const useBackTableViewsStore = defineStore('backTableViews', () => {
    let tableViews;
    /* wwFront:start */
    // eslint-disable-next-line no-undef
    tableViews = {};
    /* wwFront:end */
     const currentNavigationId = ref(undefined);
     const backTablesStore = wwLib.store.backTables;
    const latestFetchParameters = reactive({});
    const groupPagination = reactive({});
    const states = reactive({});
    const data = reactive(
        new Proxy(
            {},
            {
                get(target, key) {
                    if (typeof key === 'string' && regexUid.test(key) && !(key in target)) {
                        const isGrouped = !!getGroupingDepth(key);
                        if (
                            currentNavigationId.value === wwLib.globalVariables._navigationId &&
                            !states[key]?.isLoading &&
                            !states[key]?.isLoaded
                        )
                            fetchData(key).catch(() => null);

                        let metadata = {};
                        if (tableViews[key]?.tableId) {
                            const table = backTablesStore.integrationTables[tableViews[key].tableId];
                         }
                        return {
                            ...getPublicResultShape(null, isGrouped),
                            metadata,
                            isLoading: states[key]?.isLoading || false,
                            isLoaded: states[key]?.isLoaded || false,
                            error: states[key]?.error || null,
                        };
                    }
                    if (typeof key === 'string' && regexUid.test(key)) {
                        return {
                            ...getPublicResultShape(target[key], !!getGroupingDepth(key)),
                            metadata: target[key]?.metadata,
                            isLoading: states[key]?.isLoading,
                            isLoaded: states[key]?.isLoaded,
                            error: states[key]?.error || null,
                        };
                    } else {
                        return target[key];
                    }
                },
            }
        )
    );

    function resetData(resetPersistant) {
        currentNavigationId.value = wwLib.globalVariables._navigationId;
        const shouldKeep = key =>
            !resetPersistant && tableViews[key]?.isPersistentOnNav && (states[key]?.isLoaded || states[key]?.isLoading);
        for (const key in data) if (!shouldKeep(key)) delete data[key];
        for (const key in states) if (!shouldKeep(key)) delete states[key];
        for (const key in latestFetchParameters) if (!shouldKeep(key)) delete latestFetchParameters[key];
        for (const key in groupPagination) if (!shouldKeep(key)) delete groupPagination[key];
    }

    function setData(tableViewId, newData) {
        data[tableViewId] = newData;
    }

    function startLoading(tableViewId) {
        if (!states[tableViewId]) {
            states[tableViewId] = { isLoading: true, isLoaded: false, error: null };
            return;
        }

        states[tableViewId].isLoading = true;
        states[tableViewId].error = null;
    }

    function finishLoadingSuccess(tableViewId) {
        states[tableViewId].isLoaded = true;
        states[tableViewId].isLoading = false;
    }

    function finishLoadingError(tableViewId, error) {
        states[tableViewId].isLoaded = true;
        states[tableViewId].isLoading = false;
        states[tableViewId].error = error;
    }

    function getGroupingDepth(tableViewId) {
        return tableViews[tableViewId]?.config?.groupBy?.length || tableViews[tableViewId]?.groupingDepth || 0;
    }

    function captureGroupPagination(tableViewId, groups) {
        groupPagination[tableViewId] ||= {};

        const capture = group => {
            const pageInfo = group?.childrenPageInfo;
            if (pageInfo?.startCursor) {
                groupPagination[tableViewId][group.id] = {
                    startCursor: pageInfo.startCursor,
                    nextCursor: pageInfo.nextCursor,
                    limit: pageInfo.limit,
                    offset: pageInfo.offset,
                    total: pageInfo.total,
                    hasMore: pageInfo.hasMore,
                };
            }
            if (pageInfo) delete pageInfo.startCursor;
            for (const child of group?.children || []) capture(child);
        };

        for (const group of groups || []) capture(group);
    }

    function getSelectedGroup(tableViewId, group) {
        return group?.id ? findGroup(data[tableViewId]?.groups, group.id) : null;
    }

    function getPaginationOptions(tableViewId, { group } = {}) {
        const tableViewData = data[tableViewId];
        const isGrouped = !!getGroupingDepth(tableViewId);
        if (!isGrouped) return tableViewData?.metadata;

        if (!group) {
            const metadata = tableViewData?.metadata;
            if (!metadata) return null;
            return {
                limit: metadata.limit,
                offset: metadata.offset,
                total: metadata.levelTotal,
                hasMore: metadata.hasMore,
            };
        }

        const selectedGroup = getSelectedGroup(tableViewId, group);
        const pagination = selectedGroup && groupPagination[tableViewId]?.[selectedGroup.id];
        if (!pagination) return null;
        return {
            limit: pagination.limit,
            offset: pagination.offset,
            total: pagination.total,
            hasMore: pagination.hasMore,
        };
    }

    async function fetchData(
        tableViewId,
        { parameters = {}, cursor, noLog = false, mode = 'offset', groupId = null } = {}
    ) {
        if (!groupId) latestFetchParameters[tableViewId] = parameters;
        startLoading(tableViewId);
         try {
            let loadOptions = getGroupingDepth(tableViewId)
                ? {
                      fetchGroupedRows: true,
                      ...(cursor == null ? {} : { cursor }),
                      ...(groupId ? { requestKey: `group:${groupId}` } : {}),
                  }
                : undefined;
             const newData = await loadTableView(tableViewId, parameters, loadOptions);
            if (!newData) {
                 return;
            }

            if (!groupId && mode !== 'load-more') groupPagination[tableViewId] = {};
            if (groupId) {
                const group = findGroup(data[tableViewId]?.groups, groupId);
                if (!group || !['rows', 'groups'].includes(newData.kind))
                    throw new Error('The selected group is no longer available.');
                const currentRows = newData.kind === 'rows' ? group.rows || [] : group.children || [];
                if (newData.kind === 'groups') {
                    // The initial hydration may overlap the first child page. Keep its loaded descendants.
                    const children = new Map((mode === 'load-more' ? currentRows : []).map(child => [child.id, child]));
                    for (const child of newData.groups || [])
                        children.set(
                            child.id,
                            children.has(child.id) ? { ...child, ...children.get(child.id) } : child
                        );
                    group.children = [...children.values()];
                    captureGroupPagination(tableViewId, group.children);
                } else {
                    group.rows = mode === 'load-more' ? [...currentRows, ...(newData.rows || [])] : newData.rows;
                }
                group.childrenPageInfo = {
                    ...group.childrenPageInfo,
                    hasMore: newData.metadata?.hasMore,
                    nextCursor: newData.metadata?.nextCursor,
                    limit: newData.metadata?.limit,
                    offset: newData.metadata?.offset ?? (mode === 'load-more' ? currentRows.length : 0),
                    total: newData.metadata?.levelTotal,
                };
                groupPagination[tableViewId][groupId] = {
                    ...groupPagination[tableViewId][groupId],
                    nextCursor: newData.metadata?.nextCursor,
                    limit: newData.metadata?.limit,
                    offset: newData.metadata?.offset ?? (mode === 'load-more' ? currentRows.length : 0),
                    total: newData.metadata?.levelTotal,
                    hasMore: newData.metadata?.hasMore,
                };
            } else {
                captureGroupPagination(tableViewId, newData.groups);
                setData(
                    tableViewId,
                    mode === 'load-more' ? appendResultPage(getResultItems(data[tableViewId]), newData) : newData
                );
            }
            finishLoadingSuccess(tableViewId);
             return newData;
        } catch (error) {
            finishLoadingError(tableViewId, error);
             throw error;
        }
    }

    async function fetchMore(tableViewId, { parameters = {}, noLog = false, group } = {}) {
        const metadata = data[tableViewId]?.metadata;
        const isGrouped = !!getGroupingDepth(tableViewId);
        const nextParameters = {
            ...latestFetchParameters[tableViewId],
            ...parameters,
        };

        if (isGrouped) {
            if (group) {
                const selectedGroup = getSelectedGroup(tableViewId, group);
                if (!selectedGroup) throw new Error('The selected group is no longer available.');
                const pagination = groupPagination[tableViewId]?.[selectedGroup.id];
                if (pagination?.nextCursor == null || !pagination.hasMore) throw new Error('No more data to load.');
                return fetchData(tableViewId, {
                    parameters: {
                        ...nextParameters,
                        limit: parameters.limit ?? pagination.limit,
                        offset: 0,
                    },
                    cursor: pagination.nextCursor,
                    groupId: selectedGroup.id,
                    mode: 'load-more',
                    noLog,
                });
            }
            const cursor = metadata?.nextCursor;
            if (cursor == null) throw new Error('No more data to load.');
            delete nextParameters.offset;
            return fetchData(tableViewId, {
                parameters: nextParameters,
                cursor,
                mode: 'load-more',
                noLog,
            });
        }

        const nextOffset = metadata?.nextOffset;
        if (nextOffset == null) throw new Error('No more data to load.');
        return fetchData(tableViewId, {
            parameters: { ...nextParameters, offset: nextOffset },
            mode: 'load-more',
            noLog,
        });
    }

    async function setOffset(tableViewId, offset, { group } = {}) {
        if (!group) {
            return fetchData(tableViewId, {
                parameters: { ...latestFetchParameters[tableViewId], offset },
                noLog: true,
            });
        }

        const selectedGroup = getSelectedGroup(tableViewId, group);
        if (!selectedGroup) throw new Error('The selected group is no longer available.');
        const pagination = groupPagination[tableViewId]?.[selectedGroup.id];
        if (!pagination?.startCursor) throw new Error('The selected group is no longer available.');

        return fetchData(tableViewId, {
            parameters: {
                ...latestFetchParameters[tableViewId],
                limit: pagination.limit,
                offset,
            },
            cursor: pagination.startCursor,
            groupId: selectedGroup.id,
            noLog: true,
        });
    }

 
    return {
        tableViews,
        states,
        data,
        resetData,
        setData,
        fetchData,
        fetchMore,
        getPaginationOptions,
        setOffset,
        latestFetchParameters,
     };
});
