import { Hono } from 'hono';
import { sessionMiddleware } from '../../middlewares/auth.middlewares.js';
import { setSession, removeSession } from './auth.controllers.js';
// import authService from '../../services/auth.service.js';

const app = new Hono();

if (process.env.AUTH_SECRET) {
    // Manage custom session
    app.post('/session', setSession);
    app.delete('/session', removeSession);
}

export default app;
