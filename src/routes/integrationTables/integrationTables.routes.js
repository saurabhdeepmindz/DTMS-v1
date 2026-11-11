import { Hono } from 'hono';
import { ensureWWAuth } from '../../middlewares/weweb.middlewares.js';
import { sessionMiddleware } from '../../middlewares/auth.middlewares.js';
import { fetchWWIntegrationTable } from './integrationTables.controllers.js';

const app = new Hono();

app.use('*', sessionMiddleware);

if (process.env.ENV === 'editor') {
    app.post('/:integrationTableId', ensureWWAuth, fetchWWIntegrationTable);
}

export default app;
