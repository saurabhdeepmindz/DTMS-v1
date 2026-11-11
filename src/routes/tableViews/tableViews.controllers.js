import { HTTPException } from 'hono/http-exception';
import { getValue } from '../../services/tmp/utils/input.js';
import { throwDbError } from '../../utils/dbError.js';
import { getConnections, resolveConnectionConfig } from '../../services/connection.service.js';
import wewebService from '../../services/weweb.service.js';
import { applyDebugAuth } from '../../middlewares/auth.middlewares.js';
import { SecurityCheckError } from '../../core/errors.core.js';
import { convertConfig } from '../../utils/configConverter.ts';
import { getTableViewFormulaColumnsConfig } from '../../services/database/tableFormulaColumns.ts';
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
import {
    parseTableViewQuery,
    assertAccessRules,
    executeAccessMiddlewares,
    getAccessMiddlewareResult,
} from '../shared/accessControl.ts';
import TABLE_VIEWS from '../../data/tableViews.json' with { type: 'json' };
import TABLE_FORMULA_COLUMNS from '../../data/tableFormulaColumns.json' with { type: 'json' };

import INTEGRATION_TABLES from '../../data/integrationTables.json' with { type: 'json' };
import WORKFLOWS from '../../data/workflows.json' with { type: 'json' };

export const fetchWWTableView = async c => {
    try {
        const tableViewId = c.req.param('tableViewId');
        if (!tableViewId) throw new HTTPException(400);

        const isTest = c.req.header('ww-editor-test') === 'true';
        const editorEnv = c.req.header('ww-editor-env') || undefined;
        const includeFormulaPreviewRow = c.req.query('formulaPreviewRow') === 'true';
        const cursor = c.req.query('cursor');
        const fetchGroupedRows = c.req.query('fetchGroupedRows') === 'true';
        const options = {
            socketId: c.req.header('ww-socket-id'),
            editorUserId: c.req.header('ww-editor-user-id'),
            wwEditionMode: c.req.query('wwEditionMode') || undefined,
        };
        const result = await wewebService.getTableViewById(tableViewId, options);
        if (!result) throw new HTTPException(404);

        const { tableView, integrationTable, workflows, tableFormulaColumns } = result;
        const query = c.req.query();
        c.set('tableView', tableView); // For logging purposes

        const queryParams = parseTableViewQuery(tableView.parameters || [], query);

        // Editor debug fetches come server-to-server, without the app session cookie: a caller-supplied
        // auth context (same contract as the workflow debug run) makes gated views and session-bound
        // view configs provable. Editor-test only — that path already bypasses assertAccessRules below.
        const debugAuthHeader = isTest ? c.req.header('ww-debug-auth') : undefined;
        if (debugAuthHeader) {
            const debugAuth = JSON.parse(debugAuthHeader);
            if (debugAuth && Object.keys(debugAuth).length) await applyDebugAuth(c, debugAuth);
        }

        const context = {
            env: editorEnv,
            parameters: queryParams,
            auth: {
                user: c.get('user'),
                session: c.get('session'),
                isAuthenticated: !!c.get('user'),
            },
            honoContext: c,
        };

        if (!isTest) {
            const security = tableView.security;
            assertAccessRules(security, context.auth, { detailedErrors: true });
            const middlewareTermination = await executeAccessMiddlewares(security, workflows, context);
            if (middlewareTermination) {
                return getAccessMiddlewareResult(middlewareTermination);
            }
        }

        const response = await _fetchTableView({
            context,
            config: tableView.config,
            tableFormulaColumns,
            integrationTable,
            connection: integrationTable ? getConnections()[integrationTable.connectionId] : null,
            env: editorEnv,
            includeFormulaPreviewRow,
            cursor,
            fetchGroupedRows,
            isolateFormulaErrors: isTest && editorEnv === 'editor' && includeFormulaPreviewRow,
        });
        return c.json(response);
    } catch (err) {
        if (err instanceof FormulaQueryPlanningError) {
            throwFormulaQueryPlanningHttpError(err, 'editor');
        }
        if (err instanceof FormulaUnavailableError) {
            throwFormulaUnavailableHttpError(err, 'editor');
        }
        if (err instanceof FormulaExecutionError) {
            throwFormulaExecutionHttpError(err, c, 'editor');
        }
        if (err instanceof GroupingValidationError) {
            throw new HTTPException(400, { message: err.message });
        }
        if (err instanceof HTTPException || err instanceof SecurityCheckError) {
            throw err;
        }
        throwDbError(err);
    }
};

export const fetchTableView = async c => {
    try {
        const tableViewId = c.req.param('tableViewId');
        if (!tableViewId) throw new HTTPException(400);

        const tableView = TABLE_VIEWS[tableViewId];
        if (!tableView) throw new HTTPException(404);
        c.set('tableView', tableView); // For logging purposes

        const queryParams = parseTableViewQuery(tableView.parameters || [], c.req.query());
        const cursor = c.req.query('cursor');
        const fetchGroupedRows = c.req.query('fetchGroupedRows') === 'true';

        const context = {
            parameters: queryParams,
            auth: {
                user: c.get('user'),
                session: c.get('session'),
                isAuthenticated: !!c.get('user'),
            },
            honoContext: c,
        };

        assertAccessRules(tableView.security, context.auth);
        const middlewareTermination = await executeAccessMiddlewares(tableView.security, WORKFLOWS, context);
        if (middlewareTermination) {
            return getAccessMiddlewareResult(middlewareTermination);
        }

        const integrationTable = INTEGRATION_TABLES[tableView.tableId];
        if (tableView.tableId && !integrationTable) throw new HTTPException(404);
        const connectionId = integrationTable?.connectionId;
        const connection = getConnections()[connectionId];
        if (connectionId && !connection) throw new HTTPException(404);

        const response = await _fetchTableView({
            context,
            config: tableView.config,
            tableFormulaColumns: TABLE_FORMULA_COLUMNS,
            integrationTable,
            connection,
            cursor,
            fetchGroupedRows,
        });
        return c.json(response);
    } catch (err) {
        if (err instanceof FormulaQueryPlanningError) {
            throwFormulaQueryPlanningHttpError(err, 'published');
        }
        if (err instanceof FormulaUnavailableError) {
            throwFormulaUnavailableHttpError(err, 'published');
        }
        if (err instanceof FormulaExecutionError) {
            throwFormulaExecutionHttpError(err, c, 'published');
        }
        if (err instanceof GroupingValidationError) {
            throw new HTTPException(400, { message: err.message });
        }
        if (err instanceof HTTPException) {
            throw err;
        }
        throwDbError(err);
    }
};

async function _fetchTableView({
    context,
    config,
    tableFormulaColumns,
    integrationTable,
    connection,
    env,
    includeFormulaPreviewRow = false,
    cursor,
    fetchGroupedRows = false,
    isolateFormulaErrors = false,
}) {
    const localConfig = { ...config }; // Avoid mutating original config
    localConfig.limit = context.parameters.limit ?? localConfig.limit;
    localConfig.offset = context.parameters.offset ?? localConfig.offset;
    if (integrationTable) {
        const resolvedLocalConfig = getValue(localConfig, context);
        if (Array.isArray(resolvedLocalConfig.groupBy) && resolvedLocalConfig.groupBy.length) {
            throw new GroupingValidationError('Grouping is currently available only for WeWeb Database tables');
        }
        const resolvedConnection = resolveConnectionConfig(connection?.config, { env });
        const result = await global.tableViews[integrationTable.integration](
            resolvedConnection,
            getValue(integrationTable.config, context),
            resolvedLocalConfig
        );
        return result;
    }

    if (!localConfig.table) throw new HTTPException(400, { message: 'Table name is required' });
    localConfig.offset ||= 0;

    const resolvedConfig = {
        ...localConfig,
        filters: getValue(localConfig.filters, context),
        sort: getValue(localConfig.sort, context),
        groupBy: getValue(localConfig.groupBy, context),
        summaries: getValue(localConfig.summaries, context),
        cursor,
        fetchGroupedRows,
        groupingContext: getValue(localConfig.groupingContext, context),
        includes:
            localConfig.includes?.map(inc => ({
                ...inc,
                filters: getValue(inc.filters, context),
                sort: getValue(inc.sort, context),
            })) || [],
    };
    const convertedConfig = convertConfig(resolvedConfig);
    const schema = convertedConfig.schema || 'public';
    const formulaColumnsConfig = getTableViewFormulaColumnsConfig(tableFormulaColumns, {
        schema,
        table: convertedConfig.table,
        includes: convertedConfig.includes,
        columns: convertedConfig.columns,
    });
    return executeTableQuery({
        config: convertedConfig,
        context,
        env,
        formulaColumnsConfig,
        tableFormulaColumns,
        includeFormulaPreviewRow,
        isolateFormulaErrors,
        format: 'pretty',
        includeNextOffset: true,
    });
}
