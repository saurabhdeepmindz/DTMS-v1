import databaseService from '../../services/database/database.service.ts';
import databaseSchemaService from '../../services/database/schema.service.ts';
import {
    applyFormulaColumns,
    getLegacyFormulaColumnsConfig,
    prepareFormulaColumns,
    resolveWorkflowColumns,
    resolveWorkflowFormulaColumns,
} from '../../services/database/formulaColumns.ts';
import { prepareFormulaV2Query } from '../../services/database/formulaV2.ts';
import { executeTableQuery } from '../../services/database/tableQueryExecution.ts';
import { withFormulaExecutionBoundary } from '../../services/database/formulaExecutionErrors.ts';
import { getParametersInContext } from '../../services/tmp/codeEval/utils.js';
import { getValue } from '../../services/tmp/utils/input.js';
import TABLE_FORMULA_COLUMNS from '../../data/tableFormulaColumns.json' with { type: 'json' };

global.registerAction('sql-execute', async (action, context) => {
    if (typeof action.query !== 'string') throw new Error('SQL query must be a string');

    const { query, params } = buildSqlQuery(action.query, action.params);
    const rows = await databaseService.execute({
        query,
        params,
        currentUser: context.auth?.user,
    });
    return { rows };
});

function buildSqlQuery(query, parameters) {
    const params = parameters ?? {};
    const paramRegex = /\$([a-zA-Z0-9_]*)/g;
    const matches = [...query.matchAll(paramRegex)];
    if (matches.length === 0) return { query, params: [] };

    let paramIndex = 1;
    const paramValues = [];
    const paramMap = new Map();
    const processedQuery = query.replace(paramRegex, (match, paramName) => {
        paramMap.set(paramName, paramIndex++);
        paramValues.push(params[paramName]);
        return `$${paramMap.get(paramName)}`;
    });

    return { query: processedQuery, params: paramValues };
}

global.registerAction('table-select', async (action, context, options = {}) => {
    const metadata = { offset: action.offset || 0, limit: action.limit };
    const schema = action.tableName.includes('.') ? action.tableName.split('.')[0] : 'public';
    const table = action.tableName.includes('.') ? action.tableName.split('.')[1] : action.tableName;
    const columns = resolveWorkflowColumns(options.rawAction?.columns ?? action.columns, context);
    const formulaColumns = resolveWorkflowFormulaColumns(options.rawAction?.formulaColumns ?? action.formulaColumns);
    if (action.groupBy != null && !Array.isArray(action.groupBy)) {
        throw new Error('Group by must be an array of grouping fields.');
    }
    if (action.groupBy?.length) {
        const result = await executeTableQuery({
            config: {
                schema,
                table,
                columns,
                filters: action.filters,
                sort: action.sort,
                includes: action.includes,
                limit: action.limit,
                offset: action.offset,
                groupBy: action.groupBy,
                summaries: action.summaries,
                groupingContext: action.groupingContext,
                cursor: action.cursor || undefined,
                fetchGroupedRows: true,
            },
            context: {
                ...context,
                parameters: { ...getParametersInContext(context), ...(context.parameters || {}) },
            },
            env: context.env,
            formulaColumnsConfig: getLegacyFormulaColumnsConfig(formulaColumns),
            tableFormulaColumns: context.tableFormulaColumns ?? TABLE_FORMULA_COLUMNS,
        });
        return { ...result, data: result.kind === 'rows' ? result.rows : result.groups };
    }
    const { hasFormulaColumns, materializedColumns, normalizedColumns } = prepareFormulaColumns(
        columns,
        getLegacyFormulaColumnsConfig(formulaColumns),
        { schema, table, includes: action.includes }
    );
    const formulaV2Query = prepareFormulaV2Query({
        schema,
        table,
        columns: materializedColumns,
        filters: action.filters,
        sort: action.sort,
        includes: action.includes,
        tableFormulaColumns: context.tableFormulaColumns ?? TABLE_FORMULA_COLUMNS,
        parameters: {
            ...getParametersInContext(context),
            ...(context.parameters || {}),
        },
        env: context.env,
        auth: {
            user: context.auth?.user,
            isAuthenticated: !!context.auth?.user,
        },
    });
    const databaseSchema =
        databaseSchemaService.hasFilterValues(action.filters) ||
        databaseSchemaService.hasIncludeFilterValues(action.includes) ||
        databaseSchemaService.hasIgnoreCaseSort(action.sort, action.includes)
            ? await databaseSchemaService.getDatabaseSchema(context.env, context)
            : null;
    const selectQuery = databaseService.getSelectQuery({
        schema: schema,
        table: table,
        columns: formulaV2Query.columns,
        filters: action.filters,
        sort: action.sort,
        limit: metadata.limit,
        offset: metadata.offset,
        includes: action.includes,
        databaseSchema,
        formulaCalls: formulaV2Query.calls,
        formulaInputs: formulaV2Query.inputs,
    });
    const countQuery = databaseService.getCountQuery({
        schema: schema,
        table: table,
        filters: action.filters,
        includes: action.includes,
        databaseSchema,
        formulaCalls: formulaV2Query.calls,
        formulaInputs: formulaV2Query.inputs,
    });

    const [result, countResult] = await withFormulaExecutionBoundary(formulaV2Query.calls, () =>
        Promise.all([
            databaseService.execute({ query: selectQuery.query, params: selectQuery.params }),
            action.count ? databaseService.execute({ query: countQuery.query, params: countQuery.params }) : undefined,
        ])
    );

    if (action.count) metadata.total = parseInt(countResult[0].count);

    return {
        data: hasFormulaColumns
            ? applyFormulaColumns(result, normalizedColumns, context, formulaV2Query.calls)
            : result,
        metadata,
    };
});

global.registerAction('table-insert', async (action, context) => {
    const tableLinkData = getParametersInContext(context)?.[`table:${action.tableName}`];
    const rawData = processMapping(action.data, action.mapping, context);
    const data = processData(rawData, tableLinkData, action.columns);
    const databaseSchema = databaseSchemaService.hasDataValues(data)
        ? await databaseSchemaService.getDatabaseSchema(context.env, context)
        : null;

    const insertQuery = databaseService.getInsertQuery({
        table: action.tableName,
        data,
        upsert: action.upsert || false,
        returnData: action.returnData || false,
        databaseSchema,
    });

    return await databaseService.execute({
        query: insertQuery.query,
        params: insertQuery.params,
        currentUser: context.auth?.user,
    });
});

global.registerAction('table-update', async (action, context) => {
    const tableLinkData = getParametersInContext(context)?.[`table:${action.tableName}`];
    const data = processData(action.data, tableLinkData, action.columns);
    if (!action.filters) throw new Error('Filters are required for update operation');
    const databaseSchema =
        databaseSchemaService.hasDataValues(data) || databaseSchemaService.hasFilterValues(action.filters)
            ? await databaseSchemaService.getDatabaseSchema(context.env, context)
            : null;

    const updateQuery = databaseService.getUpdateQuery({
        table: action.tableName,
        data,
        filters: action.filters,
        returnData: action.returnData,
        databaseSchema,
    });

    return await databaseService.execute(updateQuery);
});

global.registerAction('table-delete', async (action, context) => {
    if (!action.filters) throw new Error('Filters are required for delete operation');
    const databaseSchema = databaseSchemaService.hasFilterValues(action.filters)
        ? await databaseSchemaService.getDatabaseSchema(context.env, context)
        : null;

    const deleteQuery = databaseService.getDeleteQuery({
        table: action.tableName,
        filters: action.filters,
        returnData: action.returnData,
        databaseSchema,
    });
    return await databaseService.execute(deleteQuery);
});

function processMapping(data, mapping, context) {
    if (Array.isArray(data) && mapping) {
        return data.map((item, index) => {
            return Object.keys(mapping).reduce((acc, key) => {
                acc[key] = getValue(
                    {
                        __wwtype: mapping[key].type,
                        code: mapping[key].code,
                    },
                    { ...context, mapping: { item, index } }
                );
                return acc;
            }, {});
        });
    }
    return data;
}

const SYSTEM_COLUMNS = ['id', 'createdAt', 'updatedAt'];

function isFieldAllowed(key, allowedFields) {
    if (allowedFields.length) {
        return allowedFields.includes(key);
    }
    return !SYSTEM_COLUMNS.includes(key);
}

function processData(actionData = {}, tableLinkData = {}, allowedFields = []) {
    if (Array.isArray(actionData)) {
        return actionData.map(item => {
            if (typeof item === 'object' && item !== null) {
                const processedItem = {};
                for (const [key, value] of Object.entries(item)) {
                    if (isFieldAllowed(key, allowedFields)) {
                        processedItem[key] = value;
                    }
                }
                return processedItem;
            }
            return item;
        });
    }

    const data = {};

    if (tableLinkData) {
        for (const [key, value] of Object.entries(tableLinkData)) {
            if (isFieldAllowed(key, allowedFields)) {
                data[key] = value;
            }
        }
    }

    for (const [key, value] of Object.entries(actionData)) {
        if (!data[key] || (value !== undefined && value !== null && value !== '')) {
            if (isFieldAllowed(key, allowedFields)) {
                data[key] = value;
            }
        }
    }

    return data;
}
