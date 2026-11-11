import { HTTPException } from 'hono/http-exception';
import { PublicHTTPException } from '../../core/http.errors.ts';
import databaseService from '../../services/database/database.service.ts';
import databaseSchemaService from '../../services/database/schema.service.ts';
import { getValue } from '../../services/tmp/utils/input.js';
import { throwDbError } from '../../utils/dbError.js';
import { convertConfig } from '../../utils/configConverter.ts';
import { getLegacyFormulaColumnsConfig } from '../../services/database/formulaColumns.ts';
import { getFormulaMutationTargets } from '../../services/database/formulaV2.ts';
import { GroupingValidationError } from '../../services/database/grouping.ts';
import { executeTableQuery } from '../../services/database/tableQueryExecution.ts';
import {
    FormulaExecutionError,
    FormulaQueryPlanningError,
    FormulaUnavailableError,
    throwFormulaExecutionHttpError,
    throwFormulaQueryPlanningHttpError,
    throwFormulaUnavailableHttpError,
} from '../../services/database/formulaExecutionErrors.ts';
import TABLE_FORMULA_COLUMNS from '../../data/tableFormulaColumns.json' with { type: 'json' };

export const queryTableSelect = async c => {
    const env = c.req.param('env');
    try {
        const {
            tableName,
            schema,
            columns,
            filters,
            sort,
            limit = 50,
            offset = 0,
            includes = [],
            formulaColumns,
            formulaV2Columns,
            formulaPreviewRow: includeFormulaPreviewRow = false,
            parameters = {},
            groupBy,
            summaries,
            cursor,
            fetchGroupedRows = false,
            groupingContext,
        } = await c.req.json();
        if (!tableName) return new HTTPException(400);

        const context = { parameters: parameters || {} };
        const resolvedConfig = {
            table: tableName,
            schema,
            columns,
            filters: getValue(filters, context),
            sort: getValue(sort, context),
            includes,
            limit,
            offset,
            groupBy: getValue(groupBy, context),
            summaries: getValue(summaries, context),
            cursor,
            fetchGroupedRows,
            groupingContext: getValue(groupingContext, context),
        };
        const convertedConfig = convertConfig(resolvedConfig);
        const response = await executeTableQuery({
            config: convertedConfig,
            context: {
                ...context,
                auth: {
                    user: c.get('user'),
                    isAuthenticated: !!c.get('user'),
                },
            },
            env,
            formulaColumnsConfig: getLegacyFormulaColumnsConfig(formulaColumns),
            tableFormulaColumns: env === 'editor' && formulaV2Columns ? formulaV2Columns : TABLE_FORMULA_COLUMNS,
            includeFormulaPreviewRow,
            isolateFormulaErrors: env === 'editor' && includeFormulaPreviewRow,
        });
        return c.json(response);
    } catch (err) {
        if (err instanceof FormulaQueryPlanningError) {
            throwFormulaQueryPlanningHttpError(err, env === 'editor' ? 'editor' : 'published');
        }
        if (err instanceof FormulaUnavailableError) {
            throwFormulaUnavailableHttpError(err, env === 'editor' ? 'editor' : 'published');
        }
        if (err instanceof FormulaExecutionError) {
            throwFormulaExecutionHttpError(err, c, env === 'editor' ? 'editor' : 'published');
        }
        if (err instanceof GroupingValidationError) {
            throw new HTTPException(400, { message: err.message });
        }
        throwDbError(err);
    }
};

export const queryTableInsert = async c => {
    try {
        const env = c.req.param('env');
        const {
            tableName,
            schema = 'public',
            data,
            upsert = false,
            returnData = false,
            tableFormulaColumns,
        } = await c.req.json();
        if (!tableName || !data) return new HTTPException(400);
        const formulaTargets = getFormulaMutationTargets(
            data,
            env === 'editor' && tableFormulaColumns ? tableFormulaColumns : TABLE_FORMULA_COLUMNS,
            { schema, table: tableName }
        );
        if (formulaTargets.length) {
            throw new PublicHTTPException(400, `Formula columns are read-only: ${formulaTargets.join(', ')}`, {
                code: 'FORMULA_COLUMN_READ_ONLY',
                formulaColumns: formulaTargets,
            });
        }
        const databaseSchema = databaseSchemaService.hasDataValues(data)
            ? await databaseSchemaService.getDatabaseSchema(env, c)
            : null;

        const insertQuery = databaseService.getInsertQuery({
            table: tableName,
            schema,
            data,
            upsert,
            returnData,
            databaseSchema,
        });

        const result = await databaseService.execute({
            query: insertQuery.query,
            params: insertQuery.params,
            env,
        });

        return c.json(result);
    } catch (err) {
        throwDbError(err);
    }
};

export const queryTableUpdate = async c => {
    try {
        const env = c.req.param('env');
        const {
            tableName,
            schema = 'public',
            data,
            filters,
            returnData = false,
            tableFormulaColumns,
        } = await c.req.json();
        if (!tableName || !data || !filters) return new HTTPException(400);
        const formulaTargets = getFormulaMutationTargets(
            data,
            env === 'editor' && tableFormulaColumns ? tableFormulaColumns : TABLE_FORMULA_COLUMNS,
            { schema, table: tableName }
        );
        if (formulaTargets.length) {
            throw new PublicHTTPException(400, `Formula columns are read-only: ${formulaTargets.join(', ')}`, {
                code: 'FORMULA_COLUMN_READ_ONLY',
                formulaColumns: formulaTargets,
            });
        }
        const databaseSchema =
            databaseSchemaService.hasDataValues(data) || databaseSchemaService.hasFilterValues(filters)
                ? await databaseSchemaService.getDatabaseSchema(env, c)
                : null;

        const updateQuery = databaseService.getUpdateQuery({
            table: tableName,
            schema,
            data,
            filters,
            returnData,
            databaseSchema,
        });

        const result = await databaseService.execute({
            query: updateQuery.query,
            params: updateQuery.params,
            env,
        });

        return c.json(result);
    } catch (err) {
        throwDbError(err);
    }
};

export const queryTableDelete = async c => {
    try {
        const env = c.req.param('env');
        const { tableName, schema = 'public', filters, returnData = false } = await c.req.json();
        if (!tableName || !filters) return new HTTPException(400);
        const databaseSchema = databaseSchemaService.hasFilterValues(filters)
            ? await databaseSchemaService.getDatabaseSchema(env, c)
            : null;

        const deleteQuery = databaseService.getDeleteQuery({
            table: tableName,
            schema,
            filters,
            returnData,
            databaseSchema,
        });
        const result = await databaseService.execute({
            query: deleteQuery.query,
            params: deleteQuery.params,
            env,
        });

        return c.json(result);
    } catch (err) {
        throwDbError(err);
    }
};

export const getTables = async c => {
    try {
        const env = c.req.param('env');

        const dbPool = databaseService.getPool(env);
        if (!dbPool) return new HTTPException(400);

        // TODO

        return c.json({});
    } catch (err) {
        throwDbError(err);
    }
};

export const alterTables = async c => {
    try {
        const { tableName } = await c.req.json();
        if (!tableName) return new HTTPException(400);

        const dbPool = databaseService.getPool('editor');
        if (!dbPool) return new HTTPException(400);

        // TODO

        return c.json({});
    } catch (err) {
        throwDbError(err);
    }
};
