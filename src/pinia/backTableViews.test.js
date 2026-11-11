import { beforeEach, describe, expect, it, vi } from 'vitest';
import { withStoreRegistry } from './testRegistry.test-support';
import { createPinia, setActivePinia } from 'pinia';

const mocks = vi.hoisted(() => ({
    loadTableView: vi.fn(),
}));

vi.mock('@/_common/helpers/code/tablesViews.js', () => ({
    loadTableView: mocks.loadTableView,
}));

vi.mock('@/pinia/backTables.js', () => ({
    useBackTablesStore: () => ({ integrationTables: {}, tables: { editor: {} } }),
}));

vi.mock('@/pinia/editor/viewBack.js', () => ({
    useViewBackStore: () => ({ selectedTableView: null, selectedTable: null, env: 'editor' }),
}));

vi.mock('@/pinia/editor/debugger.js', () => ({
    useDebuggerStore: () => ({ loadView: vi.fn(), endLoadView: vi.fn() }),
}));

vi.mock('@/_manager/integrations/index', () => ({ default: {} }));

import { useBackTableViewsStore } from './backTableViews.js';

describe('backTableViews store', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        const pinia = createPinia();
        setActivePinia(pinia);
        globalThis.__WW_STORE_FRONT_TABLE_VIEWS__ = {};
        globalThis.wwLib = withStoreRegistry(
            {
                $pinia: pinia,
                globalVariables: { _navigationId: 'navigation-id' },
            },
            pinia
        );
    });

    it('exposes grouped results through groups and fetches their initial rows', async () => {
        const tableViewId = '69d39c1b-f2a3-482f-9721-77378cc34a72';
        const groups = [
            {
                id: 'WzNd',
                value: 3,
                count: 100,
                summaries: { 'summary-id': 5072 },
                rows: [{ id: 'row-id', months: 3 }],
            },
        ];
        mocks.loadTableView.mockResolvedValue({
            kind: 'groups',
            groups,
            metadata: { totalRows: 100 },
        });
        const store = useBackTableViewsStore();
        store.add(tableViewId, {
            id: tableViewId,
            name: 'GroupMonth',
            config: { table: 'Number', groupBy: [{ field: ['months'], direction: 'ASC' }] },
        });

        await store.fetchData(tableViewId, { noLog: true });

        expect(store.data[tableViewId]).toMatchObject({
            groups,
            metadata: { totalRows: 100 },
            isLoading: false,
            isLoaded: true,
            error: null,
        });
        expect(store.data[tableViewId]).not.toHaveProperty('data');
        expect(mocks.loadTableView).toHaveBeenCalledWith(tableViewId, {}, { fetchGroupedRows: true, env: 'editor' });
    });

    it('uses the grouped level total for root pagination', async () => {
        const tableViewId = '69d39c1b-f2a3-482f-9721-77378cc34a72';
        mocks.loadTableView.mockResolvedValue({
            kind: 'groups',
            groups: [],
            metadata: { limit: 10, offset: 20, totalRows: 500, levelTotal: 42 },
        });
        const store = useBackTableViewsStore();
        store.add(tableViewId, {
            id: tableViewId,
            config: { table: 'Number', groupBy: [{ field: ['months'], direction: 'ASC' }] },
        });

        await store.fetchData(tableViewId, { noLog: true });

        expect(store.getPaginationOptions(tableViewId)).toMatchObject({ limit: 10, offset: 20, total: 42 });
    });

    it('paginates rows inside a selected leaf group without replacing the root groups', async () => {
        const tableViewId = '69d39c1b-f2a3-482f-9721-77378cc34a72';
        const group = {
            id: 'group-3',
            depth: 0,
            value: 3,
            count: 100,
            rows: [{ id: 'row-1' }],
            childrenPageInfo: {
                hasMore: true,
                nextCursor: 'next-row-cursor',
                startCursor: 'group-start-cursor',
                limit: 30,
                offset: 0,
                total: 100,
            },
        };
        mocks.loadTableView
            .mockResolvedValueOnce({
                kind: 'groups',
                groups: [group],
                metadata: { limit: 20, offset: 0, levelTotal: 1 },
            })
            .mockResolvedValueOnce({
                kind: 'rows',
                rows: [{ id: 'row-31' }],
                metadata: { limit: 30, offset: 30, levelTotal: 100, hasMore: true },
            });
        const store = useBackTableViewsStore();
        store.add(tableViewId, {
            id: tableViewId,
            name: 'GroupMonth',
            config: { table: 'Number', groupBy: [{ field: ['months'], direction: 'ASC' }] },
        });

        await store.fetchData(tableViewId, { parameters: { limit: 20 }, noLog: true });
        expect(store.data[tableViewId].groups[0].childrenPageInfo).not.toHaveProperty('startCursor');
        const initialPagination = store.getPaginationOptions(tableViewId, { group });
        expect(initialPagination).toMatchObject({
            limit: 30,
            offset: 0,
            total: 100,
        });
        expect(initialPagination).not.toHaveProperty('cursor');

        await store.setOffset(tableViewId, 30, { group });

        expect(mocks.loadTableView).toHaveBeenNthCalledWith(
            2,
            tableViewId,
            { limit: 30, offset: 30 },
            { fetchGroupedRows: true, cursor: 'group-start-cursor', requestKey: 'group:group-3', env: 'editor' }
        );
        expect(store.data[tableViewId].groups).toHaveLength(1);
        expect(store.data[tableViewId].groups[0].rows).toEqual([{ id: 'row-31' }]);
        expect(store.data[tableViewId].groups[0].childrenPageInfo).toMatchObject({ limit: 30, offset: 30, total: 100 });
        expect(store.getPaginationOptions(tableViewId, { group })).toMatchObject({
            limit: 30,
            offset: 30,
            total: 100,
        });
    });

    it('loads more rows inside one leaf group with its moving cursor', async () => {
        const tableViewId = '69d39c1b-f2a3-482f-9721-77378cc34a72';
        const group = {
            id: 'group-1',
            depth: 0,
            rows: [{ id: 'row-1' }],
            childrenPageInfo: {
                startCursor: 'leaf-start-cursor',
                nextCursor: 'leaf-next-cursor',
                limit: 1,
                offset: 0,
                total: 3,
                hasMore: true,
            },
        };
        mocks.loadTableView
            .mockResolvedValueOnce({
                kind: 'groups',
                groups: [group],
                metadata: { kind: 'groups', nextCursor: null },
            })
            .mockResolvedValueOnce({
                kind: 'rows',
                rows: [{ id: 'row-2' }],
                metadata: {
                    kind: 'rows',
                    limit: 1,
                    offset: 1,
                    levelTotal: 3,
                    hasMore: true,
                    nextCursor: 'leaf-last-cursor',
                },
            })
            .mockResolvedValueOnce({
                kind: 'rows',
                rows: [{ id: 'row-3' }],
                metadata: {
                    kind: 'rows',
                    limit: 1,
                    offset: 2,
                    levelTotal: 3,
                    hasMore: false,
                    nextCursor: null,
                },
            });
        const store = useBackTableViewsStore();
        store.add(tableViewId, {
            id: tableViewId,
            name: 'GroupMonth',
            config: { table: 'Number', groupBy: [{ field: ['months'], direction: 'ASC' }] },
        });

        await store.fetchData(tableViewId, { parameters: { limit: 20 }, noLog: true });
        await store.fetchMore(tableViewId, { group: store.data[tableViewId].groups[0], noLog: true });
        await store.fetchMore(tableViewId, { group: store.data[tableViewId].groups[0], noLog: true });

        expect(mocks.loadTableView).toHaveBeenNthCalledWith(
            2,
            tableViewId,
            { limit: 1, offset: 0 },
            { fetchGroupedRows: true, cursor: 'leaf-next-cursor', requestKey: 'group:group-1', env: 'editor' }
        );
        expect(mocks.loadTableView).toHaveBeenNthCalledWith(
            3,
            tableViewId,
            { limit: 1, offset: 0 },
            { fetchGroupedRows: true, cursor: 'leaf-last-cursor', requestKey: 'group:group-1', env: 'editor' }
        );
        expect(store.data[tableViewId].groups[0].rows).toEqual([{ id: 'row-1' }, { id: 'row-2' }, { id: 'row-3' }]);
        expect(store.getPaginationOptions(tableViewId, { group: store.data[tableViewId].groups[0] })).toMatchObject({
            offset: 2,
            total: 3,
            hasMore: false,
        });
    });

    it('exposes child pagination for parents and row pagination for leaves', async () => {
        const tableViewId = '69d39c1b-f2a3-482f-9721-77378cc34a72';
        const leaf = {
            id: 'leaf-group',
            depth: 1,
            count: 12,
            childrenPageInfo: {
                hasMore: false,
                nextCursor: null,
                startCursor: 'leaf-start-cursor',
                limit: 30,
                offset: 0,
                total: 12,
            },
        };
        const parent = {
            id: 'parent-group',
            depth: 0,
            count: 12,
            children: [leaf],
            childrenPageInfo: {
                hasMore: false,
                nextCursor: null,
                startCursor: 'subgroup-start-cursor',
            },
        };
        mocks.loadTableView.mockResolvedValue({
            kind: 'groups',
            groups: [parent],
            metadata: { limit: 20, offset: 0, levelTotal: 1 },
        });
        const store = useBackTableViewsStore();
        store.add(tableViewId, {
            id: tableViewId,
            config: {
                table: 'Number',
                groupBy: [
                    { field: ['months'], direction: 'ASC' },
                    { field: ['number'], direction: 'ASC' },
                ],
            },
        });

        await store.fetchData(tableViewId, { noLog: true });

        expect(store.getPaginationOptions(tableViewId, { group: parent })).toMatchObject({ hasMore: false });
        expect(store.getPaginationOptions(tableViewId, { group: leaf })).toMatchObject({
            limit: 30,
            offset: 0,
            total: 12,
        });
        expect(store.data[tableViewId].groups[0].childrenPageInfo).not.toHaveProperty('startCursor');
        expect(store.data[tableViewId].groups[0].children[0].childrenPageInfo).not.toHaveProperty('startCursor');
    });

    it('exposes an empty groups array before a grouped view has loaded', () => {
        const tableViewId = '69d39c1b-f2a3-482f-9721-77378cc34a72';
        const store = useBackTableViewsStore();
        store.add(tableViewId, {
            id: tableViewId,
            name: 'GroupMonth',
            config: { table: 'Number', groupBy: [{ field: ['months'], direction: 'ASC' }] },
        });

        expect(store.data[tableViewId].groups).toEqual([]);
        expect(store.data[tableViewId]).not.toHaveProperty('data');
    });

    it('keeps flat view rows exposed through data', async () => {
        const tableViewId = '5d369c41-cd1a-4328-af42-c6bc81142739';
        const rows = [{ id: 'row-id' }];
        mocks.loadTableView.mockResolvedValue({ data: rows, metadata: { total: 1 } });
        const store = useBackTableViewsStore();
        store.add(tableViewId, {
            id: tableViewId,
            name: 'Flat view',
            config: { table: 'Number', groupBy: [] },
        });

        await store.fetchData(tableViewId, { noLog: true });

        expect(store.data[tableViewId].data).toEqual(rows);
        expect(store.data[tableViewId]).not.toHaveProperty('groups');
    });

    it('loads the next grouped page with its cursor and appends the groups', async () => {
        const tableViewId = '69d39c1b-f2a3-482f-9721-77378cc34a72';
        const firstGroup = { id: 'group-1', value: 3, rows: [{ id: 'row-1' }] };
        const secondGroup = { id: 'group-2', value: 6, rows: [{ id: 'row-2' }] };
        mocks.loadTableView
            .mockResolvedValueOnce({
                kind: 'groups',
                groups: [firstGroup],
                metadata: { nextCursor: 'next-group-cursor' },
            })
            .mockResolvedValueOnce({
                kind: 'groups',
                groups: [secondGroup],
                metadata: { nextCursor: null },
            });
        const store = useBackTableViewsStore();
        store.add(tableViewId, {
            id: tableViewId,
            name: 'GroupMonth',
            config: { table: 'Number', groupBy: [{ field: ['months'], direction: 'ASC' }] },
        });

        await store.fetchData(tableViewId, { parameters: { limit: 1 }, noLog: true });
        await store.fetchMore(tableViewId, { parameters: { limit: 1 }, noLog: true });

        expect(mocks.loadTableView).toHaveBeenNthCalledWith(
            2,
            tableViewId,
            { limit: 1 },
            { fetchGroupedRows: true, cursor: 'next-group-cursor', env: 'editor' }
        );
        expect(store.data[tableViewId]).toMatchObject({
            groups: [firstGroup, secondGroup],
            metadata: { nextCursor: null },
        });
    });

    it('keeps offset pagination for flat views', async () => {
        const tableViewId = '5d369c41-cd1a-4328-af42-c6bc81142739';
        const firstRow = { id: 'row-1' };
        const secondRow = { id: 'row-2' };
        mocks.loadTableView
            .mockResolvedValueOnce({ data: [firstRow], metadata: { nextOffset: 1 } })
            .mockResolvedValueOnce({ data: [secondRow], metadata: { nextOffset: null } });
        const store = useBackTableViewsStore();
        store.add(tableViewId, {
            id: tableViewId,
            name: 'Flat view',
            config: { table: 'Number', groupBy: [] },
        });

        await store.fetchData(tableViewId, { parameters: { limit: 1 }, noLog: true });
        await store.fetchMore(tableViewId, { noLog: true });

        expect(mocks.loadTableView).toHaveBeenNthCalledWith(2, tableViewId, { limit: 1, offset: 1 }, { env: 'editor' });
        expect(store.data[tableViewId]).toMatchObject({
            data: [firstRow, secondRow],
            metadata: { nextOffset: null },
        });
    });

    it('rejects load more when the current view has no next page', async () => {
        const tableViewId = '69d39c1b-f2a3-482f-9721-77378cc34a72';
        const store = useBackTableViewsStore();
        store.add(tableViewId, {
            id: tableViewId,
            name: 'GroupMonth',
            config: { table: 'Number', groupBy: [{ field: ['months'], direction: 'ASC' }] },
        });
        store.setData(tableViewId, {
            kind: 'groups',
            groups: [],
            metadata: { nextCursor: null },
        });

        await expect(store.fetchMore(tableViewId, { noLog: true })).rejects.toThrow('No more data to load.');
        expect(mocks.loadTableView).not.toHaveBeenCalled();
    });

    it('exposes rows returned for a grouped child page through rows', () => {
        const tableViewId = '69d39c1b-f2a3-482f-9721-77378cc34a72';
        const rows = [{ id: 'row-1' }, { id: 'row-2' }];
        const store = useBackTableViewsStore();

        store.setData(tableViewId, {
            kind: 'rows',
            rows,
            metadata: { nextCursor: null },
        });

        expect(store.data[tableViewId].rows).toEqual(rows);
        expect(store.data[tableViewId]).not.toHaveProperty('data');
    });
    it('hydrates a published grouped view from its minimal manifest', async () => {
        const id = '69d39c1b-f2a3-482f-9721-77378cc34a72';
        const store = useBackTableViewsStore();
        store.add(id, { id, groupingDepth: 2 });
        mocks.loadTableView.mockResolvedValue({ kind: 'groups', groups: [], metadata: {} });
        expect(store.data[id]).toHaveProperty('groups');
        await store.fetchData(id, { noLog: true });
        expect(mocks.loadTableView).toHaveBeenCalledWith(id, {}, { fetchGroupedRows: true, env: 'editor' });
    });

    it('loads intermediate children and keeps hydrated descendants when a page overlaps', async () => {
        const id = '69d39c1b-f2a3-482f-9721-77378cc34a72';
        const store = useBackTableViewsStore();
        store.add(id, { id, groupingDepth: 2 });
        mocks.loadTableView
            .mockResolvedValueOnce({
                kind: 'groups',
                groups: [
                    {
                        id: 'parent',
                        depth: 0,
                        children: [
                            {
                                id: 'a',
                                depth: 1,
                                rows: [{ id: 1 }],
                                childrenPageInfo: {
                                    startCursor: 'leaf-start',
                                    nextCursor: 'leaf-next',
                                    hasMore: true,
                                    limit: 1,
                                    total: 2,
                                },
                            },
                        ],
                        childrenPageInfo: {
                            startCursor: 'start',
                            nextCursor: 'start',
                            hasMore: true,
                            limit: 20,
                            total: 2,
                        },
                    },
                ],
                metadata: {},
            })
            .mockResolvedValueOnce({
                kind: 'groups',
                groups: [
                    {
                        id: 'a',
                        depth: 1,
                        childrenPageInfo: {
                            startCursor: 'leaf-start',
                            nextCursor: 'leaf-start',
                            hasMore: true,
                            limit: 30,
                            total: 2,
                        },
                    },
                    { id: 'b', depth: 1 },
                ],
                metadata: { hasMore: false, nextCursor: null, limit: 20, offset: 0, levelTotal: 2 },
            });
        await store.fetchData(id, { noLog: true });
        const parent = store.data[id].groups[0];
        await store.fetchMore(id, { group: parent, noLog: true });
        expect(parent.children.map(child => child.id)).toEqual(['a', 'b']);
        expect(parent.children[0].rows).toEqual([{ id: 1 }]);
        expect(store.getPaginationOptions(id, { group: parent })).toMatchObject({ total: 2, hasMore: false });
        mocks.loadTableView.mockResolvedValueOnce({
            kind: 'rows',
            rows: [{ id: 2 }],
            metadata: { hasMore: false, nextCursor: null, limit: 1, offset: 1, levelTotal: 2 },
        });
        await store.fetchMore(id, { group: parent.children[0], noLog: true });
        expect(mocks.loadTableView.mock.calls[2][2].cursor).toBe('leaf-next');
        expect(parent.children[0].rows).toEqual([{ id: 1 }, { id: 2 }]);
    });
});
