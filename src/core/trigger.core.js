import { APIError } from 'better-call';
import { packagedExecutionData, prepareWorkflowExecution } from '../services/workflowExecution.service.ts';
import wewebService from '../services/weweb.service.js';
import workflowCore from '../core/workflow.core.js';

const isEditor = process.env.ENV === 'editor';

function formatError(err, workflow) {
    if (err instanceof APIError) {
        return err;
    }
    const message = isEditor ? err.message : 'Internal Server Error';
    return new APIError('INTERNAL_SERVER_ERROR', {
        message,
        ...(isEditor && {
            workflow: {
                id: workflow?.id,
                name: workflow?.name,
            },
            name: err.name,
            stack: err.stack,
            cause: err.cause,
            code: err.code,
        }),
    });
}

export default {
    async execute(
        trigger,
        event,
        { socketId = null, editorUserId = null, honoContext = null, snapshot = null, awaitCompletion = false }
    ) {
        let executionData = snapshot || packagedExecutionData;
        let triggeredWorkflows = executionData.workflows.filter(workflow => workflow.trigger === trigger);

        if (
            !snapshot &&
            process.env.ENV === 'editor' &&
            !(process.env.WEWEB_ENV === 'local' && process.env.NODE_ENV === 'production')
        ) {
            const options = { socketId, editorUserId };
            const result = await wewebService.getBackWorkflowsByTrigger(trigger, options);
            const { workflows, subWorkflows } = result;
            executionData = { ...result, workflows: subWorkflows };
            triggeredWorkflows = workflows;
        }

        const executions = triggeredWorkflows.map(async workflow => {
            try {
                return await workflowCore.execute(workflow, {
                    ...prepareWorkflowExecution(executionData),
                    auth: {
                        user: honoContext?.get('user'),
                        session: honoContext?.get('session'),
                        isAuthenticated: !!honoContext?.get('user'),
                    },
                    awaitCompletion,
                    event,
                    socketId,
                    honoContext,
                });
            } catch (err) {
                throw formatError(err, workflow);
            }
        });
        if (!awaitCompletion) {
            return await Promise.all(executions);
        }

        // Failure hooks may run together, but no sibling may outlive the owning Jobs invocation.
        const results = await Promise.allSettled(executions);
        const failure = results.find(result => result.status === 'rejected');
        if (failure) {
            throw failure.reason;
        }
    },
};
