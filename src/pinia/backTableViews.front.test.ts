import { beforeEach, expect, it, vi } from 'vitest';
import { withStoreRegistry } from './testRegistry.test-support';
import { createPinia, setActivePinia } from 'pinia';
const mocks = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock('@/_common/helpers/code/tablesViews.js', () => ({ loadTableView: mocks.load }));
vi.mock('@/pinia/backTables.js', () => ({ useBackTablesStore: () => ({ integrationTables: {} }) }));
// @ts-expect-error Vitest resolves the target query through wewebTargetBlockPlugin.
import { useBackTableViewsStore } from './backTableViews.js?ww-target=front';
const id = '69d39c1b-f2a3-482f-9721-77378cc34a72';
beforeEach(() => {
    vi.clearAllMocks();
    const pinia = createPinia();
    setActivePinia(pinia);
    globalThis.__WW_STORE_FRONT_TABLE_VIEWS__ = { [id]: { id, groupingDepth: 2 } };
    withStoreRegistry({ globalVariables: { _navigationId: 'navigation-id' } }, pinia);
});
it('hydrates a published grouping and paginates intermediate groups without editor config', async () => {
    mocks.load
        .mockResolvedValueOnce({
            kind: 'groups',
            groups: [
                {
                    id: 'parent',
                    depth: 0,
                    children: [],
                    childrenPageInfo: {
                        startCursor: 'child-start',
                        nextCursor: 'child-start',
                        hasMore: true,
                        limit: 20,
                        total: 1,
                    },
                },
            ],
            metadata: {},
        })
        .mockResolvedValueOnce({
            kind: 'groups',
            groups: [
                {
                    id: 'leaf',
                    depth: 1,
                    childrenPageInfo: {
                        startCursor: 'row-start',
                        nextCursor: null,
                        hasMore: false,
                        limit: 30,
                        total: 0,
                    },
                },
            ],
            metadata: { hasMore: false, nextCursor: null, limit: 20, offset: 0, levelTotal: 1 },
        });
    const store = useBackTableViewsStore();
    expect(store.data[id]).toHaveProperty('groups');
    await store.fetchData(id);
    expect(mocks.load).toHaveBeenNthCalledWith(1, id, {}, { fetchGroupedRows: true });
    const parent = store.data[id].groups[0];
    await store.fetchMore(id, { group: parent });
    expect(mocks.load).toHaveBeenNthCalledWith(
        2,
        id,
        { limit: 20, offset: 0 },
        { fetchGroupedRows: true, cursor: 'child-start', requestKey: 'group:parent' }
    );
    expect(parent.children).toHaveLength(1);
    expect(store.getPaginationOptions(id, { group: parent })).toMatchObject({ total: 1, hasMore: false });
});
