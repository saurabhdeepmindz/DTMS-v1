import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

const mocks = vi.hoisted(() => ({
    refreshFormulaColumns: vi.fn(),
}));

vi.mock('@/_manager/backend/formulaColumns.service', () => ({
    refreshFormulaColumns: mocks.refreshFormulaColumns,
}));

import { useBackTableFormulaColumnsStore } from './backTableFormulaColumns';

describe('backTableFormulaColumns store', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        setActivePinia(createPinia());
    });

    it('skips artifact refresh when the project has no Formula V2 columns', async () => {
        const store = useBackTableFormulaColumnsStore();
        store.add('legacy-formula-id', {
            id: 'legacy-formula-id',
            schema: 'public',
            tableName: 'orders',
            name: 'legacyTotal',
            formula: { __wwtype: 'f', code: 'context.row.amount * 2' },
            engineVersion: 1,
        });

        await store.ensureCurrentArtifacts();

        expect(mocks.refreshFormulaColumns).not.toHaveBeenCalled();
    });

    it('refreshes artifacts once per editor session and applies the current catalog', async () => {
        const store = useBackTableFormulaColumnsStore();
        store.add('formula-id', {
            id: 'formula-id',
            schema: 'public',
            tableName: 'orders',
            name: 'total',
            formula: { __wwtype: 'f', code: 'context.row.amount * 2' },
            engineVersion: 2,
        });
        mocks.refreshFormulaColumns.mockResolvedValue({
            refreshed: 1,
            columns: [
                {
                    ...store.tableFormulaColumns['formula-id'],
                    compiledArtifact: {
                        graphHash: 'current-graph-hash',
                        sqlSchema: 'ww_formula',
                        sqlName: 'current-formula',
                        resultType: { formulaType: 'number', postgresType: 'double precision' },
                        inputTypes: [],
                    },
                },
            ],
        });

        await Promise.all([store.ensureCurrentArtifacts(), store.ensureCurrentArtifacts()]);

        expect(mocks.refreshFormulaColumns).toHaveBeenCalledOnce();
        expect(store.tableFormulaColumns['formula-id']).toEqual(
            expect.objectContaining({
                compiledArtifact: expect.objectContaining({ graphHash: 'current-graph-hash' }),
            })
        );
    });

    it('marks transferred V2 formulas as pending until an artifact is active', () => {
        const store = useBackTableFormulaColumnsStore();
        store.add('pending-v2', {
            id: 'pending-v2',
            schema: 'public',
            tableName: 'orders',
            name: 'total',
            formula: { __wwtype: 'f', code: 'context.row.subtotal' },
            engineVersion: 2,
        });

        expect(store.getConfigForTable('orders', 'public')).toEqual({
            total: {
                __wwtype: 'f',
                code: 'context.row.subtotal',
                __wwFormulaColumnId: 'pending-v2',
                __wwFormulaEngineVersion: 2,
                __wwDatabaseFormulaStatus: 'pending',
            },
        });
    });

    it('marks permanent transferred formula failures as needing attention', () => {
        const store = useBackTableFormulaColumnsStore();
        store.add('failed-v2', {
            id: 'failed-v2',
            schema: 'public',
            tableName: 'orders',
            name: 'total',
            formula: { __wwtype: 'f', code: 'fetch("https://example.com")' },
            engineVersion: 2,
            transferErrorCode: 'FORMULA_VALIDATION_FAILED',
        });

        expect(store.getConfigForTable('orders', 'public')).toEqual({
            total: {
                __wwtype: 'f',
                code: 'fetch("https://example.com")',
                __wwFormulaColumnId: 'failed-v2',
                __wwFormulaEngineVersion: 2,
                __wwDatabaseFormulaStatus: 'error',
                __wwDatabaseFormulaErrorCode: 'FORMULA_VALIDATION_FAILED',
            },
        });
    });

    it('builds the V2 runtime catalog for the root and included tables only', () => {
        const store = useBackTableFormulaColumnsStore();
        store.add('root-v2', {
            id: 'root-v2',
            schema: 'public',
            tableName: 'orders',
            name: 'total',
            formula: { __wwtype: 'f', code: '1' },
            engineVersion: 2,
        });
        store.add('include-v2', {
            id: 'include-v2',
            schema: 'crm',
            tableName: 'customers',
            name: 'score',
            formula: { __wwtype: 'f', code: '1' },
            engineVersion: 2,
        });
        store.add('unrelated-v2', {
            id: 'unrelated-v2',
            schema: 'public',
            tableName: 'products',
            name: 'margin',
            formula: { __wwtype: 'f', code: '1' },
            engineVersion: 2,
        });
        store.add('include-v1', {
            id: 'include-v1',
            schema: 'crm',
            tableName: 'customers',
            name: 'legacy',
            formula: { __wwtype: 'f', code: '1' },
            engineVersion: 1,
        });

        expect(
            store
                .getV2RuntimeCatalogForQuery('orders', 'public', [
                    { table: 'customers', schema: 'crm' },
                ])
                .map(column => column.id)
                .sort()
        ).toEqual(['include-v2', 'root-v2']);
    });
});
