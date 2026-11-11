import { Hono } from 'hono';
import { ensureWWAuth } from '../../middlewares/weweb.middlewares.js';
import { sessionMiddleware } from '../../middlewares/auth.middlewares.js';
import { executeWorkflow, executeEditorWorkflow, executeDebugWorkflow } from './workflows.controllers.js';
import workflows from '../../data/workflows.json' with { type: 'json' };
import { isInternal } from '../../core/appAccess.core.ts';

// An internal app's sign-in and access routes are its own: an endpoint there would read the sign-in codes the workspace's
// shared callback sends it, which any of its apps could redeem.
const RESERVED_PATH = /^\/(auth|ww\/access)(\/|$)/i;

const app = new Hono();

app.use('*', sessionMiddleware);

if (process.env.ENV === 'editor') {
    app.post('/debug/run', ensureWWAuth, executeDebugWorkflow);
    app.all('*', ensureWWAuth, executeEditorWorkflow);
} else {
    for (const workflow of workflows.filter(workflow => workflow.trigger === 'ww-api')) {
        if (isInternal() && RESERVED_PATH.test(workflow.meta?.path || '')) {
            console.warn(`[app-access] The endpoint ${workflow.meta.path} is reserved for signing in: not served.`);
            continue;
        }
        app.on(
            workflow.meta?.method || 'POST',
            workflow.meta?.path || `/ww/workflows/${workflow.id}`,
            (c, next) => {
                c.set('workflow', workflow);
                return next();
            },
            executeWorkflow
        );
    }
}

export default app;
