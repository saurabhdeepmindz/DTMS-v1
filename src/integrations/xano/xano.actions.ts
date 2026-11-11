import { getXanoClient, buildPath, buildRequestBody, enrichXanoError } from './xano.utils.ts';

global.registerAction('xano/request', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getXanoClient(context.connection);

    const session = context.honoContext?.get('session');
    if (session?.accessToken) {
        client.setAuthToken(session.accessToken);
    }

    if (!args.endpoint?.path || !args.endpoint?.method) {
        throw new Error('Xano request requires an endpoint with a path and a method');
    }

    const path = buildPath(args.endpoint.path, args.params || {});
    const endpoint = `/api:${args.apiGroupCanonical}${path}`;
    const method = args.endpoint.method.toLowerCase();
    const payload = method === 'get' ? (args.query || {}) : await buildRequestBody(args.body);

    try {
        return await client[method](endpoint, payload, args?.headers);
    } catch (error: any) {
        enrichXanoError(error);
    }
});

global.registerAction('xano/auth-set-user', async ({ args = {} }: ActionParams, context: ActionContext) => {
    context.honoContext.set('user', args.user);
    return args.user;
});
