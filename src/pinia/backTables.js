import { defineStore } from 'pinia';
import { reactive, watch } from 'vue';
 
export const useBackTablesStore = defineStore('backTables', () => {
    const integrationsStore = wwLib.store.integrations;
    const tables = reactive({
        editor: {},
        staging: {},
        production: {},
    });
    const integrationTables = reactive({});
    const isLoading = reactive({
        editor: true,
        staging: true,
        production: true,
    });

    /* wwFront:start */
    // eslint-disable-next-line no-undef
    Object.assign(integrationTables, {});
    /* wwFront:end */

    const setTablesState = (env, data = []) => {
        if (!tables[env]) return;
        tables[env] = data.reduce((acc, table) => {
            acc[table.name] = table;
            return acc;
        }, {});
    };

    let loadTables = async () => {};

 
    const isIntegrationTable = tableIdentifier => {
        return tableIdentifier && tableIdentifier.includes('/');
    };

    const getTableInfo = tableIdentifier => {
        if (isIntegrationTable(tableIdentifier)) {
            const [integration, id] = tableIdentifier.split('/');
            const table = integrationTables[id];
            if (!table) return null;

            return {
                id: table.id,
                name: table.name,
                integration,
                connectionId: table.connectionId,
                config: table.config,
                icon: integrations?.[integration]?.icon || `logos/${integration}`,
                rawTable: table,
            };
        }

        const table = tables.editor[tableIdentifier];
        if (!table) return null;

        return {
            id: tableIdentifier,
            name: tableIdentifier,
            integration: null,
            connectionId: null,
            config: null,
            icon: 'logos/weweb',
            rawTable: table,
        };
    };

    const getTableColumns = tableIdentifier => {
        const tableInfo = getTableInfo(tableIdentifier);
        if (!tableInfo) return [];

        if (tableInfo.integration) {
            // eslint-disable-next-line no-useless-assignment -- Used when the wwEditor block is stripped from the front build.
            let renderedColumns = [];
             return renderedColumns;
        }

        const physicalColumns = (tableInfo.rawTable.columns || [])
            .filter(column => !column.isSystem)
            .map(column => ({
                id: column.name,
                name: column.name,
                type: column.type,
                label: column.name,
                isRequired: column.isRequired,
                defaultValue: column.defaultValue,
                isSystem: column.isSystem || false,
                isIntegration: false,
                linkedColumn: column.linkedColumn,
            }));
        const formulaColumns = backTableFormulaColumnsStore.getByTable(tableIdentifier).map(column => ({
            id: column.id,
            name: column.name,
            type: 'text',
            label: column.name,
            isRequired: false,
            isIntegration: false,
            isFormulaColumn: true,
            isComputed: true,
            isReadOnly: true,
            formula: column.formula,
        }));

        return [...physicalColumns, ...formulaColumns];
    };

    const getTableOptions = () => {
        const nativeOptions = Object.values(tables.editor).map(table => ({
            label: table.name,
            value: table.name,
            icon: 'logos/weweb',
            isIntegration: false,
        }));

        const integrationOptions = Object.values(integrationTables).map(table => ({
            label: table.name,
            value: `${table.integration}/${table.id}`,
            icon: integrations?.[table.integration]?.icon || `logos/${table.integration}`,
            isIntegration: true,
        }));

        return [...nativeOptions, ...integrationOptions];
    };

    return {
        tables,
        integrationTables,
        isLoading,
        addIntegrationTable(table) {
            if (!table?.id) return;
            integrationTables[table.id] = table;
        },
        async refreshTables(env) {
            await loadTables(env);
        },
         isIntegrationTable,
        getTableInfo,
        getTableColumns,
        getTableOptions,
    };
});
