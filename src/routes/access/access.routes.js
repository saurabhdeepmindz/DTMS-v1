import { Hono } from 'hono';
import { isInternal } from '../../core/appAccess.core.ts';
import { getDenied, getSignedOut, signIn } from './access.controllers.ts';

const app = new Hono();

// Registered in every environment, only effective on internal apps (the gate is off elsewhere).
app.use('*', async (c, next) => (isInternal() ? next() : c.notFound()));
app.get('/sign-in', signIn);
app.get('/denied', getDenied);
app.get('/signed-out', getSignedOut);
// Nothing else here, and nothing falls through to the app's own routes.
app.all('*', c => c.notFound());

export default app;
