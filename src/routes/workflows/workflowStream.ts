import type { Context } from 'hono';
import type { SSEMessage } from 'hono/streaming';
import { streamSSE } from 'hono/streaming';
import { getResponseStreamHeartbeatIntervalMs } from './workflowResponseConfig.ts';

type WorkflowAction = {
    type?: string;
};

type WorkflowDefinition = {
    id?: string;
    meta?: {
        responseMode?: string;
    } | null;
    actions?: Record<string, WorkflowAction> | null;
};

type WorkflowStreamContext = {
    honoContext?: Context;
    lateResponseStarted?: boolean;
    workflowStreamStarted?: boolean;
    writeWorkflowSSE?: (message: SSEMessage) => Promise<void>;
};

function getActionBaseType(action: WorkflowAction = {}) {
    if (typeof action.type !== 'string') return action.type;
    return action.type.split(':')[0];
}

function getNestedWorkflowId(action: WorkflowAction = {}) {
    if (getActionBaseType(action) !== 'execute-backend-workflow') return null;
    return (action as WorkflowAction & { workflowId?: string }).workflowId || action.type?.split(':')[1] || null;
}

function getWorkflowById(workflows: WorkflowDefinition[] = [], workflowId: string) {
    return workflows.find(workflow => workflow.id === workflowId);
}

export function hasWorkflowStreamAction(
    workflow: WorkflowDefinition = {},
    workflows: WorkflowDefinition[] = [],
    visitedWorkflowIds = new Set<string>()
) {
    if (workflow.id) {
        if (visitedWorkflowIds.has(workflow.id)) return false;
        visitedWorkflowIds.add(workflow.id);
    }

    for (const action of Object.values(workflow.actions || {})) {
        if (getActionBaseType(action) === 'send-streaming-response') return true;

        const nestedWorkflowId = getNestedWorkflowId(action);
        if (!nestedWorkflowId) continue;

        const nestedWorkflow = getWorkflowById(workflows, nestedWorkflowId);
        if (nestedWorkflow && isWorkflowStreamMode(nestedWorkflow, workflows, visitedWorkflowIds)) return true;
    }

    return false;
}

export function isWorkflowStreamMode(
    workflow: WorkflowDefinition = {},
    workflows: WorkflowDefinition[] = [],
    visitedWorkflowIds = new Set<string>()
) {
    if (workflow.meta && Object.hasOwn(workflow.meta, 'responseMode')) {
        return workflow.meta.responseMode === 'stream';
    }

    return hasWorkflowStreamAction(workflow, workflows, visitedWorkflowIds);
}

export function executeWithWorkflowStream<T>(
    c: Context,
    workflowContext: WorkflowStreamContext,
    execute: () => Promise<T>
) {
    return streamSSE(
        c,
        async stream => {
            let heartbeatId: NodeJS.Timeout | null = null;
            let lastWriteAt = Date.now();
            const heartbeatIntervalMs = getResponseStreamHeartbeatIntervalMs();

            const writeRaw = async (data: string) => {
                lastWriteAt = Date.now();
                await stream.write(data);
            };

            workflowContext.workflowStreamStarted = true;
            workflowContext.writeWorkflowSSE = async message => {
                lastWriteAt = Date.now();
                await stream.writeSSE(message);
            };

            await writeRaw(': open\n\n');

            heartbeatId = setInterval(() => {
                if (Date.now() - lastWriteAt < heartbeatIntervalMs) return;
                void writeRaw(': ping\n\n').catch(error => {
                    console.error(error);
                });
            }, heartbeatIntervalMs);

            try {
                await execute();
            } catch (error) {
                await writeWorkflowStreamError(workflowContext, error);
            } finally {
                if (heartbeatId) clearInterval(heartbeatId);
            }
        },
        async (error, stream) => {
            await stream.writeSSE({
                data: JSON.stringify({
                    error: error.message || 'Streaming error',
                    errorType: error.name || 'Error',
                }),
                event: 'error',
            });
        }
    );
}

export async function writeWorkflowStreamMessage(context: WorkflowStreamContext, data: unknown) {
    if (context.lateResponseStarted) {
        throw new Error('Cannot send a streaming response after the late response stream has started');
    }

    if (!context.writeWorkflowSSE) return false;

    await context.writeWorkflowSSE({
        data: JSON.stringify(data),
        event: 'message',
    });
    return true;
}

async function writeWorkflowStreamError(context: WorkflowStreamContext, error: unknown) {
    if (!context.writeWorkflowSSE) return;

    const normalizedError = error instanceof Error ? error : new Error('Streaming error');
    await context.writeWorkflowSSE({
        data: JSON.stringify({
            error: normalizedError.message || 'Streaming error',
            errorType: normalizedError.name || 'Error',
        }),
        event: 'error',
    });
}
