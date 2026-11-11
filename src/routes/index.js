import accessRoutes from './access/access.routes.js';
import accessEditorRoutes from './access/access.editor.routes.js';
import authRoutes from './auth/auth.routes.js';
import workflowsRoutes from './workflows/workflows.routes.js';
import tablesRoutes from './tables/tables.routes.js';
import tableViewsRoutes from './tableViews/tableViews.routes.js';
import storageRoutes from './storage/storage.routes.js';
import integrationTablesRoutes from './integrationTables/integrationTables.routes.js';
import wewebRoutes from './weweb/weweb.routes.js';
import { editor as editorRoutes, app as appRoutes, publicApp as publicRoutes } from '../integrations/registry.ts';
import { ensureWWAuth } from '../middlewares/weweb.middlewares.js';
import { loadEditorRuntime } from '../middlewares/editorRuntime.middlewares.ts';
import { appendWebhookFallbacks } from '../services/webhook.service.ts';
import { Hono } from 'hono';

function withEditorRuntime(routes) {
    appendWebhookFallbacks(routes);
    const app = new Hono();
    // Attach runtime loading to actual public endpoints, so unmatched requests
    // reach the editor authorization check before loading any project secrets.
    for (const route of routes.routes) {
        app.on(route.method, route.path, loadEditorRuntime, route.handler);
    }
    return app;
}

export function registerRoutes(app) {
    app.route('/ww', wewebRoutes);
    app.route('/ww/auth', authRoutes);
    app.route('/ww/access', accessRoutes);
    app.route('/', withEditorRuntime(publicRoutes));
    if (process.env.ENV === 'editor') {
        app.use('*', ensureWWAuth, loadEditorRuntime);
        app.route('/ww/tables', tablesRoutes);
        app.route('/ww/integrations', editorRoutes);
        app.route('/ww/integration/tables', integrationTablesRoutes);
        app.route('/ww/storage', storageRoutes);
        app.route('/ww/app-access', accessEditorRoutes);
    }
    app.route('/ww/table-views', tableViewsRoutes);
    app.route('/', appRoutes);
    app.route('/', workflowsRoutes);
}
