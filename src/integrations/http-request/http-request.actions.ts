import { betterFetch } from '@better-fetch/fetch';

global.registerAction('http-request/http-request', async ({ args }: ActionParams) => {
    try {
        return await betterFetch(args.url, {
            method: args.method,
            body: args.body,
            query: args.query,
            params: args.params,
            auth: {
                type: args.auth?.type,
                username: args.auth?.username,
                password: args.auth?.password,
                token: args.auth?.token,
            },
            headers: args.headers,
            retry: {
                type: args.retry?.type || 'linear',
                attempts: args.retry?.attempts || 1,
                delay: args.retry?.delay || 0,
                baseDelay: args.retry?.baseDelay || 0,
                maxDelay: args.retry?.maxDelay,
            },
            throw: true,
            timeout: args.timeout,
        });
    } catch (error) {
        error.data = error?.error;
        delete error.error;
        delete error.cause;
        throw error;
    }
});
