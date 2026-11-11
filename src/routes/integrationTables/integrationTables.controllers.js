import { HTTPException } from 'hono/http-exception';
import { throwDbError } from '../../utils/dbError.js';
import { getConnections, resolveConnectionConfig } from '../../services/connection.service.js';
import { getValue } from '../../services/tmp/utils/input.js';
import wewebService from '../../services/weweb.service.js';

export const fetchWWIntegrationTable = async c => {
    try {
        const integrationTableId = c.req.param('integrationTableId');
        if (!integrationTableId) throw new HTTPException(400);

        const editorEnv = c.req.header('ww-editor-env') || undefined;
        const { offset, limit } = await c.req.json();

        const options = {
            socketId: c.req.header('ww-socket-id'),
            editorUserId: c.req.header('ww-editor-user-id'),
        };
        const { integrationTable } = (await wewebService.getIntegrationTableById(integrationTableId, options)) || {};
        if (!integrationTable) throw new HTTPException(404);

        const resolvedConnection = resolveConnectionConfig(getConnections()[integrationTable.connectionId]?.config, {
            env: editorEnv,
        });
        const context = { parameters: {} };
        const { data, metadata } = await global.tableViews[integrationTable.integration](
            resolvedConnection,
            getValue(integrationTable.config, context),
            { offset, limit }
        );

        return c.json({ data, metadata });
    } catch (err) {
        if (err instanceof HTTPException) {
            throw err;
        }
        throwDbError(err);
    }
};
