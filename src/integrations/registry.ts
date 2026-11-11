import type { Context } from 'hono';
import { Hono } from 'hono';
import { ensureWWAuth } from '../middlewares/weweb.middlewares.js';
import { resolveConnectionConfig } from '../services/connection.service.js';
import utils from './utils.ts';

// ======= ACTIONS =======
global.actions = {};
global.registerAction = <TArgs = IntegrationArgs>(type: string, handler: ActionHandler<TArgs>) => {
    if (global.actions[type]) throw new Error(`Action type "${type}" is already registered`);
    global.actions[type] = handler as ActionHandler;
};

// ======= TABLE VIEWS =======
global.tableViews = {};
global.registerTableView = <
    TConnection = ConnectionConfig,
    TTable = TableConfig,
    TView = ViewConfig,
>(
    integration: string,
    handler: TableViewHandler<TConnection, TTable, TView>
) => {
    if (global.tableViews[integration]) throw new Error(`Table View "${integration}" is already registered`);
    global.tableViews[integration] = handler as TableViewHandler;
};

// ======= HOOKS =======
global.hooks = {};
global.registerHook = (type: string, key: string, handler: Function) => {
    if (!global.hooks) global.hooks = {};
    if (!global.hooks[type]) global.hooks[type] = {};
    if (!global.hooks[type][key]) global.hooks[type][key] = [];
    global.hooks[type][key].push(handler);
};

// ======= ROUTES =======
const app = new Hono();
const editor = new Hono();
const publicApp = new Hono();

if (process.env.ENV === 'editor') {
    app.use('*', ensureWWAuth);
    editor.use('*', ensureWWAuth);
    editor.use('*', async (c: Context, next) => {
        if (c.req.method !== 'GET' && c.req.method !== 'DELETE') {
            const { connection } = await c.req.json();
            if (connection) {
                c.set('connection', resolveConnectionConfig(connection.config));
            }
        }

        await next();
    });
}

global.editor = editor;
global.app = app;
global.public = publicApp;

// ======= UTILS =======
global.utils = utils;

export { app, editor, publicApp };
