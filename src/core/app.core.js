import { Hono } from 'hono';
import { contextStorage } from 'hono/context-storage';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import { appAccessMiddleware } from '../middlewares/appAccess.middlewares.ts';
import { registerRoutes } from '../routes/index.js';
import { getCorsOrigin } from './config.core.js';
import { SecurityCheckError } from './errors.core.js';
import { serializeHttpError } from './http.errors.ts';
import { StorageInvalidPathError } from './storage.errors.ts';
import { logEndpoint } from './logger.core.ts';
import '../integrations/index.ts';

const app = new Hono();
app.use(contextStorage());

app.onError((err, c) => {
    console.error(err);

    if (err instanceof SecurityCheckError) {
        return c.json(err.data, err.status);
    }

    if (err instanceof HTTPException) {
        return c.json(serializeHttpError(err), err.status);
    }

    if (err instanceof StorageInvalidPathError) {
        return c.json({ code: err.code, message: err.message }, err.status);
    }

    return c.json({ message: 'Internal Server Error' }, 500);
});

app.use(async (c, next) => {
    c.set('_startTime', Date.now());
    c.set('_requestId', Math.random().toString(36).substring(2, 15));

    await next();

    logEndpoint(c).catch(console.error);
});
app.use(
    '*',
    cors({
        origin: getCorsOrigin,
        allowHeaders: [
            'Content-Type',
            'Authorization',
            'X-API-Key',
            'Cookie',
            'ww-socket-id',
            'ww-editor-user-id',
            'ww-editor-env',
            'ww-debug',
            'ww-editor-test',
            'ww-editor-action-id',
            'ww-editor-previous-results',
            'ww-editor-trace-id',
            'ww-access-token',
        ],
        allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        exposeHeaders: ['Content-Length', 'X-WeWeb-Late-Response'],
        credentials: true,
    })
);
app.use('*', appAccessMiddleware);

function createApiApp() {
    const apiApp = new Hono();
    registerRoutes(apiApp);
    return apiApp;
}

app.route('/api/stream', createApiApp());
app.route('/api', createApiApp());

export default app;
