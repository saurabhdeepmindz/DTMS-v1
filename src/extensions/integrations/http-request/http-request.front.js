import { getValue } from '@/_common/helpers/code/customCode.js';
import { betterFetch } from '@better-fetch/fetch';
import { get } from 'lodash-es';

export default {
    async loadView({ tableConfig, viewConfig = {}, parameters = {} }) {
        const context = { parameters };
        const processedViewConfig = getValue(viewConfig, context);
        const processedTableConfig = getValue(tableConfig, context);
        const baseConfig = {
            url: processedTableConfig.url,
            method: processedTableConfig.method || 'GET',
            params: processedTableConfig.params,
            query: processedTableConfig.query,
            body: processedTableConfig.body,
            headers: processedTableConfig.headers,
            auth: {
                type: processedTableConfig.auth.type,
                username: processedTableConfig.auth.username,
                password: processedTableConfig.auth.password,
                token: processedTableConfig.auth.token,
            },
        };

        for (const key of Object.keys(processedViewConfig.params || {})) {
            if (!baseConfig.params) baseConfig.params = {};
            if (processedViewConfig.params[key]) baseConfig.params[key] = processedViewConfig.params[key];
        }

        for (const key of Object.keys(processedViewConfig.query || {})) {
            if (!baseConfig.query) baseConfig.query = {};
            if (processedViewConfig.query[key]) baseConfig.query[key] = processedViewConfig.query[key];
        }

        for (const key of Object.keys(processedViewConfig.body || {})) {
            if (!baseConfig.body) baseConfig.body = {};
            if (processedViewConfig.body[key]) baseConfig.body[key] = processedViewConfig.body[key];
        }

        const response = await betterFetch(baseConfig.url, {
            method: baseConfig.method,
            body: baseConfig.body,
            query: baseConfig.query,
            params: baseConfig.params,
            auth: baseConfig.auth,
            headers: baseConfig.headers,
            throw: true,
        });

        let extractedData = response;
        if (tableConfig.dataPath) {
            extractedData = get(response, tableConfig.dataPath);
        } else {
            extractedData = response;
        }

        let extractedMetadata = {};
        if (tableConfig.metadataPath) {
            const metadata = get(response, tableConfig.metadataPath);
            if (metadata && typeof metadata === 'object') {
                extractedMetadata = metadata;
            }
        }

        return {
            data: extractedData,
            metadata: extractedMetadata,
        };
    },
    actions: {
        'http-request': async ({ args }) => {
            try {
                return await betterFetch(args.url, {
                    method: args.method || 'GET',
                    body: args.body,
                    query: args.query,
                    params: args.params,
                    credentials: args.credentials,
                    auth: {
                        type: args.auth?.type,
                        username: args.auth?.username,
                        password: args.auth?.password,
                        token: args.auth?.token,
                    },
                    headers: args.headers,
                    retry: {
                        type: args.retry?.type || 'linear',
                        attempts: args.retry?.attempts || 0,
                        delay: args.retry?.delay || 0,
                        baseDelay: args.retry?.baseDelay || 0,
                        maxDelay: args.retry?.maxDelay,
                    },
                    throw: true,
                    timeout: args.timeout,
                    cache: args.cache,
                    keepalive: args.keepAlive,
                    mode: args.mode,
                    priority: args.priority,
                });
            } catch (error) {
                error.data = error?.error;
                delete error.error;
                delete error.cause;
                throw error;
            }
        },
    },
};
