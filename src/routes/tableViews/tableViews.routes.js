import { Hono } from 'hono';
import { ensureWWAuth } from '../../middlewares/weweb.middlewares.js';
import { sessionMiddleware } from '../../middlewares/auth.middlewares.js';
import { fetchWWTableView, fetchTableView } from './tableViews.controllers.js';

const app = new Hono();

app.use('*', sessionMiddleware);

if (process.env.ENV === 'editor') {
    app.get('/:tableViewId', ensureWWAuth, fetchWWTableView);
} else {
    app.get('/:tableViewId', fetchTableView);
}

export default app;
