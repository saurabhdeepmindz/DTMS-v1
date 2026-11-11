import { Hono } from 'hono';
import { ensureWWAuth } from '../../middlewares/weweb.middlewares.js';
import {
    queryTableSelect,
    queryTableInsert,
    queryTableUpdate,
    queryTableDelete,
    getTables,
    alterTables,
} from './tables.controllers.js';

const app = new Hono();

app.use('*', ensureWWAuth);

if (process.env.DATABASE_URL) {
    app.get('/:env', getTables);
    app.patch('/editor', alterTables);
    app.post('/:env/select', queryTableSelect);
    app.post('/:env/insert', queryTableInsert);
    app.post('/:env/update', queryTableUpdate);
    app.post('/:env/delete', queryTableDelete);
}

export default app;
