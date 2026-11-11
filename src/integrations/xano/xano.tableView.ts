import { getXanoClient, buildPath, enrichXanoError } from './xano.utils.ts';

global.registerTableView('xano', async (connection: ConnectionConfig, table: TableConfig, view: ViewConfig) => {
    const client = getXanoClient(connection);

    const pathParams = { ...(table?.params || {}), ...(view.params || {}) };
    const rawQueryParams = { ...(table?.query || {}), ...(view.query || {}) };
    const queryParams: Record<string, any> = {};
    for (const [key, value] of Object.entries(rawQueryParams)) {
        if (value !== undefined && value !== null && value !== '') {
            queryParams[key] = value;
        }
    }
    const headers = { ...(table?.headers || {}), ...(view.headers || {}) };

    if (!table?.endpoint?.path) {
        throw new Error('Xano table view requires an endpoint with a path');
    }

    const path = buildPath(table.endpoint.path, pathParams);
    const endpoint = `/api:${table.apiGroupCanonical}${path}`;

    let response;
    try {
        response = await client.get(endpoint, queryParams, headers);
    } catch (error: any) {
        enrichXanoError(error);
    }
    const body = response.getBody();

    const isPaginated = body && !Array.isArray(body) && Array.isArray(body.items) && 'curPage' in body;

    return {
        data: isPaginated ? body.items : body,
        metadata: isPaginated ? { ...body, items: undefined } : {},
    };
});
