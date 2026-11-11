import workflowCore from '../../core/workflow.core.js';
import { streamSSE } from 'hono/streaming';
import { writeWorkflowStreamMessage } from '../../routes/workflows/workflowStream.ts';
import { setTimeout as sleep } from 'node:timers/promises';
import { getWorkflowSignal } from '../../services/workflowContext.service.ts';

function parsePath(path) {
    return path
        .replace(/\[(\d+)\]/g, '.$1')
        .split('.')
        .filter(Boolean);
}

function cloneValue(value) {
    return value === undefined ? value : structuredClone(value);
}

function getWorkflowVariableInitialValue(variableType, value) {
    if (value !== undefined) {
        return value;
    }

    switch (variableType) {
        case 'string':
            return '';
        case 'number':
            return 0;
        case 'boolean':
            return true;
        case 'array':
            return [];
        case 'object':
            return {};
        default:
            return value;
    }
}

function setByPath(target, path, value) {
    const segments = parsePath(path);
    let current = target;

    for (const [index, segment] of segments.entries()) {
        const isLast = index === segments.length - 1;
        if (isLast) {
            current[segment] = value;
            return target;
        }

        const nextSegment = segments[index + 1];
        const shouldCreateArray = /^\d+$/.test(nextSegment);
        const nextValue = current[segment];

        if (nextValue && typeof nextValue === 'object') {
            current = nextValue;
            continue;
        }

        current[segment] = shouldCreateArray ? [] : {};
        current = current[segment];
    }

    return target;
}

global.registerAction('filter', (action, context) => {
    context.workflow.stop = !action.value;
    return action.value;
});

global.registerAction('next', (action, context) => {
    context.workflow.stop = true;
});

global.registerAction('if', (action, context) => {
    return !!action.value;
});

global.registerAction('switch', (action, context) => {
    return action.value;
});

global.registerAction('trycatch', (action, context) => {
    return true;
});

global.registerAction('loop', async (action, context, { callback, cleanupScopedVariables }) => {
    if (!Array.isArray(action.value)) throw new Error('Fail to start loop, as items to parse is not iterable');

    context.workflow.breakLoop = false;
    const previousScopeId = context.scopeId;

    for (const [index, item] of action.value.entries()) {
        const loopScopeId = `${context.workflowDefinition.id}_${action.id}_loop_${index}`;
        context.scopeId = loopScopeId;
        context.workflow[action.id].loop = { index, item, items: action.value };
        await callback(action.loop);
        cleanupScopedVariables?.(context, loopScopeId);
        if (context.workflow.breakLoop) break;
    }

    context.scopeId = previousScopeId;
    context.workflow.breakLoop = false;
});

global.registerAction(
    'while-loop',
    async (action, context, { callback, rawAction, getValue, cleanupScopedVariables }) => {
        let value = !!action.value;

        context.workflow.breakLoop = false;
        const previousScopeId = context.scopeId;
        let index = 0;

        while (value) {
            const loopScopeId = `${context.workflowDefinition.id}_${action.id}_loop_${index}`;
            context.scopeId = loopScopeId;
            await callback(action.loop);
            cleanupScopedVariables?.(context, loopScopeId);
            if (context.workflow.breakLoop) break;
            value = !!getValue(rawAction.value, context);
            index++;
        }

        context.scopeId = previousScopeId;
        context.workflow.breakLoop = false;
    }
);

global.registerAction('continue-loop', (action, context) => {
    context.workflow.stop = !!action.value;
    return action.value;
});

global.registerAction('break-loop', (action, context) => {
    context.workflow.breakLoop = !!action.value;
    return action.value;
});

global.registerAction('wait', async (action, context) => {
    if (action.value === undefined) throw new Error('Wait action requires either value or duration property');

    if (typeof action.value !== 'number' || Number.isNaN(action.value))
        throw new TypeError('Wait duration must evaluate to a number');

    await sleep(action.value, undefined, { signal: getWorkflowSignal() });

    return action.value;
});

global.registerAction('throw', (action, context) => {
    throw new Error(action.args.message, { cause: action.args.cause });
});

global.registerAction('return', (action, context) => {
    return action.value;
});

global.registerAction('create-variable', (action, context) => {
    const value = getWorkflowVariableInitialValue(action.variableType, action.variableValue);
    context.workflow.variables[action.id] = {
        value,
        type: action.variableType || 'string',
        scopeId: context.scopeId || null,
    };

    return value;
});

global.registerAction('update-variable', (action, context) => {
    if (!action.varId) throw new Error('No variable selected.');
    const variable = context.workflow.variables[action.varId];
    if (!variable) throw new Error('Workflow variable not found. Create it first.');

    let newValue = action.varValue;

    if (variable.type === 'object' && action.usePath && action.path) {
        const baseValue =
            variable.value && typeof variable.value === 'object' && !Array.isArray(variable.value)
                ? cloneValue(variable.value)
                : {};
        newValue = setByPath(baseValue, action.path, action.varValue);
    }

    if (variable.type === 'array' && action.arrayUpdateType) {
        const arr = Array.isArray(variable.value) ? cloneValue(variable.value) : [];
        switch (action.arrayUpdateType) {
            case 'push':
                arr.push(action.varValue);
                break;
            case 'unshift':
                arr.unshift(action.varValue);
                break;
            case 'insert':
                arr.splice(action.index || 0, 0, action.varValue);
                break;
            case 'update':
                arr[action.index || 0] = action.varValue;
                break;
            case 'delete':
                arr.splice(action.index || 0, 1);
                break;
            case 'shift':
                arr.shift();
                break;
            case 'pop':
                arr.pop();
                break;
        }
        newValue = arr;
    }

    variable.value = newValue;
    return variable.value;
});

global.registerAction('reset-variables', (action, context, { getValue }) => {
    for (const varId of action.varsId || []) {
        if (!varId) continue;
        const createAction = context.workflowDefinition?.actions?.[varId];
        if (createAction && context.workflow.variables[varId]) {
            context.workflow.variables[varId].value = getWorkflowVariableInitialValue(
                createAction.variableType,
                getValue(createAction.variableValue, context)
            );
        }
    }
});

global.registerAction('return-result', (action, context) => {
    const { data, continueWorkflow } = action.args;

    if (!continueWorkflow) {
        context.workflow.stop = true;
    }
    context.resultActionId = action.id;
    context.returnResult?.(data);

    return data;
});

global.registerAction('execute-backend-workflow', async (action, context) => {
    const workflowId = action.workflowId || action.type.split(':')?.[1];
    if (!workflowId) throw new Error('Workflow ID is required');
    const workflow = context.workflows.find(workflow => workflow.id === workflowId);
    if (!workflow) throw new Error(`Workflow "${workflowId}" not found`);

    const subWorkflowContext = {
        ...context,
        parameters: action.parameters,
        workflowResponse: null,
    };

    const result = await workflowCore.execute(workflow, subWorkflowContext);
    if (subWorkflowContext.workflowResponse) {
        if (subWorkflowContext.workflow.stop) context.workflow.stop = true;
        context.workflowResponse = subWorkflowContext.workflowResponse;
    }

    return result;
});

global.registerAction('return-response', (action, context) => {
    const { status = 200, contentType = 'application/json', body, headers = {}, continueWorkflow } = action.args;

    context.workflowResponse = {
        metadata: {
            status,
            contentType,
            body,
            headers,
        },
    };

    if (!continueWorkflow) {
        context.workflow.stop = true;
    }

    if (context.lateResponseStarted || context.workflowStreamStarted) {
        return body ?? null;
    }

    for (const [key, value] of Object.entries(headers)) {
        context.honoContext.header(key, value);
    }

    context.honoContext.status(status || 200);
    if (status !== 204) {
        if (contentType === 'application/json') {
            context.honoContext.res = context.honoContext.json(body ?? null);
        } else if (contentType === 'text/plain') {
            context.honoContext.res = context.honoContext.text(body);
        } else if (contentType === 'text/html') {
            context.honoContext.res = context.honoContext.html(body);
        }
    }
    context.workflowResponse.httpResponse = context.honoContext.res;

    // disable early response because of aws lambda limitations
    // if(context.sendResponse) context.sendResponse({
    //     status,
    //     contentType,
    //     body,
    //     headers
    // });
});

global.registerAction('send-streaming-response', async (action, context) => {
    const { data = null } = action.args;

    if (await writeWorkflowStreamMessage(context, data)) {
        return data;
    }

    if (!context.stream) {
        context.streamComplete = new Promise((resolve, reject) => {
            context.streamResolve = resolve;
            context.streamReject = reject;
        });

        const streamResponse = streamSSE(
            context.honoContext,
            async stream => {
                try {
                    stream.onAbort(() => {
                        if (context.streamReject) {
                            context.streamReject(new Error('Stream aborted by client'));
                        }
                    });

                    context.stream = stream;

                    await stream.writeSSE({
                        data: JSON.stringify(data),
                        event: 'message',
                    });

                    await context.streamComplete;
                } catch (error) {
                    await context.stream.writeSSE({
                        data: JSON.stringify({
                            error: error.message || 'Streaming error',
                            errorType: error.name || 'Error',
                        }),
                        event: 'error',
                    });
                }
            },
            err => {
                if (context.streamReject) {
                    context.streamReject(err);
                }
            }
        );

        if (context.sendResponse) {
            context.sendResponse(streamResponse);
        }
    } else {
        await context.stream.writeSSE({
            data: JSON.stringify(data),
            event: 'message',
        });
    }

    return data;
});

global.registerAction('notes', () => {});
