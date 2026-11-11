import { computed, shallowReactive } from 'vue';
import { defineStore } from 'pinia';
import { refreshFormulaColumns } from '@/_manager/backend/formulaColumns.service';

type FormulaBinding = {
    __wwtype: string;
    code: string;
    [key: string]: unknown;
};

export type BackTableFormulaColumn = {
    id: string;
    projectId?: string | null;
    schema?: string | null;
    tableName: string;
    name: string;
    formula: FormulaBinding;
    engineVersion?: 1 | 2;
    transferErrorCode?: string | null;
    compiledArtifact?: {
        graphHash: string;
        sqlSchema: string;
        sqlName: string;
        resultType: { formulaType: string; postgresType: string };
        inputTypes: Array<{ name: string; postgresType: string; optional: boolean }>;
    } | null;
    [key: string]: unknown;
};

function normalizeSchema(schema?: string | null) {
    return schema || 'public';
}

export const useBackTableFormulaColumnsStore = defineStore('backTableFormulaColumns', () => {
    const tableFormulaColumns = shallowReactive<Record<string, BackTableFormulaColumn>>({});
    let currentArtifactsPromise: Promise<void> | null = null;

    function add(id: string, tableFormulaColumn: BackTableFormulaColumn, { partialUpdate = false } = {}) {
        if (!id || !tableFormulaColumn) return;

        tableFormulaColumns[id] = {
            ...(partialUpdate ? tableFormulaColumns[id] || {} : tableFormulaColumn),
            ...tableFormulaColumn,
            id,
        };
    }

    function remove(id: string) {
        if (!id) return;
        delete tableFormulaColumns[id];
    }

    function getByTable(tableName?: string | null, schema?: string | null) {
        if (!tableName) return [];
        const normalizedSchema = normalizeSchema(schema);
        return Object.values(tableFormulaColumns).filter(
            column => column.tableName === tableName && normalizeSchema(column.schema) === normalizedSchema
        );
    }

    function getConfigForTable(tableName?: string | null, schema?: string | null) {
        return getByTable(tableName, schema).reduce<Record<string, unknown>>((config, column) => {
            config[column.name] = {
                ...column.formula,
                __wwFormulaColumnId: column.id,
                __wwFormulaEngineVersion: column.engineVersion || 1,
                ...(column.engineVersion === 2
                    ? {
                          __wwDatabaseFormulaStatus: column.compiledArtifact
                              ? 'active'
                              : column.transferErrorCode
                                ? 'error'
                                : 'pending',
                          ...(column.transferErrorCode
                              ? { __wwDatabaseFormulaErrorCode: column.transferErrorCode }
                              : {}),
                      }
                    : {}),
            };
            return config;
        }, {});
    }

    function getV2RuntimeCatalogForQuery(
        tableName?: string | null,
        schema?: string | null,
        includes: Array<{ table?: string | null; schema?: string | null }> = []
    ) {
        const scopes = new Set([`${normalizeSchema(schema)}\u0000${tableName || ''}`]);
        for (const include of includes) {
            if (!include.table) continue;
            scopes.add(`${normalizeSchema(include.schema)}\u0000${include.table}`);
        }
        return Object.values(tableFormulaColumns).filter(
            column =>
                column.engineVersion === 2 &&
                scopes.has(`${normalizeSchema(column.schema)}\u0000${column.tableName}`)
        );
    }

    function ensureCurrentArtifacts() {
        if (!Object.values(tableFormulaColumns).some(column => column.engineVersion === 2)) {
            return Promise.resolve();
        }
        if (currentArtifactsPromise) return currentArtifactsPromise;
        currentArtifactsPromise = refreshFormulaColumns()
            .then(({ columns }) => {
                for (const column of columns || []) {
                    add(column.id as string, column as BackTableFormulaColumn);
                }
            })
            .catch(error => {
                currentArtifactsPromise = null;
                throw error;
            });
        return currentArtifactsPromise;
    }

    return {
        tableFormulaColumns,
        data: computed(() => tableFormulaColumns),
        add,
        remove,
        getByTable,
        getConfigForTable,
        getV2RuntimeCatalogForQuery,
        ensureCurrentArtifacts,
    };
});
