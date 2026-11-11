import { betterFetch } from '@better-fetch/fetch';
import { getNestedValue } from '../../services/tmp/utils/input.js';

global.registerTableView('http-request', async (connection: ConnectionConfig, table: TableConfig, view: ViewConfig) => {
    const baseConfig = {
        url: table.url,
        method: table.method,
        params: table.params,
        query: table.query,
        body: table.body,
        headers: table.headers,
        auth: {
            type: table.auth?.type,
            username: table.auth?.username,
            password: table.auth?.password,
            token: table.auth?.token,
        },
    };

    for (const key of Object.keys(view.params || {})) {
        if (!baseConfig.params) baseConfig.params = {};
        if (view.params[key]) baseConfig.params[key] = view.params[key];
    }

    for (const key of Object.keys(view.query || {})) {
        if (!baseConfig.query) baseConfig.query = {};
        if (view.query[key]) baseConfig.query[key] = view.query[key];
    }

    for (const key of Object.keys(view.body || {})) {
        if (!baseConfig.body) baseConfig.body = {};
        if (view.body[key]) baseConfig.body[key] = view.body[key];
    }

    // Execute HTTP request
    const response = await betterFetch(baseConfig.url, {
        method: baseConfig.method,
        body: baseConfig.body,
        query: baseConfig.query,
        params: baseConfig.params,
        auth: baseConfig.auth,
        headers: baseConfig.headers,
        throw: true,
    });

    // Extract data using dataPath
    let extractedData = response;
    if (table.dataPath) {
        extractedData = getNestedValue(response, table.dataPath);
    } else {
        extractedData = response;
    }

    // Extract metadata using metadataPath
    let extractedMetadata = {};
    if (table.metadataPath) {
        const metadata = getNestedValue(response, table.metadataPath);
        if (metadata && typeof metadata === 'object') {
            extractedMetadata = metadata;
        }
    }

    return { data: extractedData, metadata: extractedMetadata };
});
