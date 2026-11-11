import { createHash, timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import databaseService from '../../services/database/database.service.ts';
import { accessHandlers } from './access.controllers.ts';

// The editor's server, for WeWeb only: the directory and the grants of an internal app's staging
// or production database, which it reaches from the moment the project's backend is created,
// published or not, and the directory in its own (`editor`), for editors to try the app as anyone
// of the company. The project secret only: an editor's session doesn't open them, giving app
// access is the project's access managers' (checked by WeWeb).
const app = new Hono();

// Compared in constant time, as digests of the same length.
const digest = value => createHash('sha256').update(value).digest();
const isProjectSecret = value =>
    !!process.env.WEWEB_PROJECT_SECRET &&
    typeof value === 'string' &&
    timingSafeEqual(digest(value), digest(process.env.WEWEB_PROJECT_SECRET));

// On the routes' own path: a `*` middleware has no `env` parameter.
app.use('/:env/*', async (c, next) => {
    if (!isProjectSecret(c.req.header('ww-project-secret'))) throw new HTTPException(403, { message: 'Forbidden' });
    const env = c.req.param('env');
    if (!['editor', 'staging', 'production'].includes(env)) throw new HTTPException(404, { message: 'Not found' });
    c.set('requestBody', c.req.method === 'GET' ? '' : await c.req.text());
    return next();
});

const handlers = accessHandlers(c => databaseService.getPool(c.req.param('env')));

app.post('/:env/sync', handlers.syncDirectory);
app.get('/:env/admin', handlers.getAccessStatus);
app.patch('/:env/admin/grants', handlers.patchGrants);
app.put('/:env/admin/managed-grants', handlers.putManagedGrants);

export default app;
