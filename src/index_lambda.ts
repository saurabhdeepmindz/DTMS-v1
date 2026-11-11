import './core/env.core.js';
import app from './core/app.core.js';
import { getLambdaHandlerFactory } from './services/lambdaHandler.service.ts';

import { executeJobs, wakeJobsAfterResponse } from './jobs/runtime.ts';
import { flushWorkflowLogs } from './services/weweb.service.js';

export const handler = getLambdaHandlerFactory({
    afterResponse: wakeJobsAfterResponse,
    flushLogs: flushWorkflowLogs,
    runJobs: async (event, context) => {
        context.callbackWaitsForEmptyEventLoop = false;
        await executeJobs({
            installationId: event.installationId,
            deadline: Date.now() + context.getRemainingTimeInMillis(),
        });
    },
})(app);
