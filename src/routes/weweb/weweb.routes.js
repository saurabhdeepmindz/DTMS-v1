import { Hono } from 'hono';
import { getHealth, getVersion } from './weweb.controllers.js';

const app = new Hono();

app.get('/health', getHealth);
app.get('/version', getVersion);

export default app;
