import { getValue } from '../services/tmp/utils/input.js';
import wewebService from '../services/weweb.service.js';
import { workflowCheckpoint } from '../services/workflowContext.service.ts';

const STRUCTURAL_KEYS = new Set(['id', 'type', 'next', 'name', 'branches', 'disabled', '__wwdescription']);
const STRUCTURED_STREAM_CHUNK_KEY = '__wwStructuredStreamChunk';

function getActionBaseType(action) {
    if (typeof action?.type !== 'string') return action?.type;
    return action.type.split(':')[0];
}

function computeActionConfiguration(action, actionType, context) {
    if (actionType !== 'table-select') return getValue(action, context);

    // Column definitions need a row (or the SQL planner), not the workflow's current context.
    const { formulaColumns, ...configuration } = action;
    const computedConfiguration = getValue(configuration, context);
    if (Object.hasOwn(action, 'formulaColumns')) {
        computedConfiguration.formulaColumns = formulaColumns;
    }
    return computedConfiguration;
}

function isWorkflowStreamAction(action) {
    return action?.args?.__wwstream === true;
}

function isAsyncIterableResult(result) {
    return !!result && typeof result === 'object' && Symbol.asyncIterator in result;
}

function isStructuredStreamChunk(chunk) {
    return !!chunk && typeof chunk === 'object' && Object.hasOwn(chunk, STRUCTURED_STREAM_CHUNK_KEY);
}

function createWorkflowStreamState() {
    return {
        chunks: [],
        chunk: null,
        text: '',
        parts: [],
        part: null,
    };
}

function applyStructuredStreamChunk(stream, chunk) {
    const textDelta = typeof chunk.chunk === 'string' ? chunk.chunk : '';
    stream.part = chunk.part || null;

    if (chunk.runLoop !== false) {
        stream.chunk = textDelta;
    }

    if (textDelta) {
        stream.chunks.push(textDelta);
        stream.text += textDelta;
    }

    if (chunk.part) {
        stream.parts.push(chunk.part);
    }
}

function applyPlainStreamChunk(stream, chunk) {
    stream.chunks.push(chunk);
    stream.chunk = chunk;

    if (typeof chunk === 'string') {
        stream.text += chunk;
    }
}

function cleanupScopedVariables(context, scopeId) {
    if (!scopeId || !context.workflow.variables) return;
    for (const [actionId, varData] of Object.entries(context.workflow.variables)) {
        if (varData.scopeId === scopeId) {
            delete context.workflow.variables[actionId];
        }
    }
}

export default {
    async executeAction(workflow, action, context) {
        if (action.disabled) return;
        const actionType = getActionBaseType(action);
        if (!global.actions[actionType]) throw new Error(`Action type "${actionType}" is not supported`);

        if (action.connectionId) context.connection = context.connections?.[action.connectionId]?.config;

        let actionConfig;
        try {
            actionConfig = computeActionConfiguration(action, actionType, context);
            if (process.env.ENV === 'editor') {
                context.workflow[action.id].computedConfig = JSON.parse(JSON.stringify(actionConfig));
                for (const key of Object.keys(context.workflow[action.id].computedConfig)) {
                    if (STRUCTURAL_KEYS.has(key)) {
                        delete context.workflow[action.id].computedConfig[key];
                    }
                }
            }
        } catch (err) {
            if (process.env.ENV === 'editor') {
                context.workflow[action.id].computedConfig = {
                    name: err.name,
                    message: err.message,
                };
            }
            throw {
                name: 'ConfigurationError',
                message: `Failed to compute action configuration`,
            };
        }

        const result = await global.actions[actionType](actionConfig, context, {
            callback: actionId => this.executeActions(workflow, context, actionId),
            rawAction: action,
            getValue,
            cleanupScopedVariables,
        });
        await workflowCheckpoint();

        if (isWorkflowStreamAction(action) && isAsyncIterableResult(result)) {
            context.workflow[action.id].stream = createWorkflowStreamState();

            for await (const chunk of result) {
                await workflowCheckpoint();
                let shouldRunLoop = true;
                if (isStructuredStreamChunk(chunk)) {
                    applyStructuredStreamChunk(context.workflow[action.id].stream, chunk);
                    shouldRunLoop = chunk.runLoop !== false;
                } else {
                    applyPlainStreamChunk(context.workflow[action.id].stream, chunk);
                }

                if (shouldRunLoop && action.loop) {
                    await this.executeActions(workflow, context, action.loop);
                }
            }

            return context.workflow[action.id].stream.chunks;
        }

        return result;
    },

    async executeActions(workflow, context, actionId, queue = []) {
        await workflowCheckpoint();
        if (!actionId) return { result: undefined, error: undefined };
        context.workflow[actionId] = { result: undefined, error: undefined };
        context.workflow.stop = false;

        try {
            const action = workflow.actions[actionId];
            if (!action) {
                if (actionId?.type === 'scope-exit') {
                    cleanupScopedVariables(context, actionId.scopeId);
                    context.scopeId = actionId.previousScopeId;
                    if (actionId.then) {
                        return await this.executeActions(workflow, context, actionId.then, queue);
                    } else if (queue.length) {
                        return await this.executeActions(workflow, context, queue.shift(), queue);
                    }
                    return { result: undefined, error: undefined };
                }
                throw new Error('Action not found');
            }

            try {
                context.workflow[actionId].result = await this.executeAction(workflow, action, context);
            } catch (error) {
                context.workflow[actionId].error =
                    error instanceof Error ? { name: error.name, message: error.message, cause: error.cause } : error;
                wewebService.sendWorkflowDebug(workflow.id, { [actionId]: context.workflow[actionId] }, context.socketId, { traceId: context.traceId, executionId: context.debugExecutionId });
                throw error;
            }

            wewebService.sendWorkflowDebug(workflow.id, { [actionId]: context.workflow[actionId] }, context.socketId, { traceId: context.traceId, executionId: context.debugExecutionId });

            if (context.workflow.stop) {
                return context.workflow[actionId].result;
            }

            let branch = (action.branches || []).find(({ value }) => value === context.workflow[actionId].result);
            if (!branch) {
                branch = (action.branches || []).find(({ isDefault }) => isDefault);
            }

            if (branch?.id && !action.disabled) {
                const branchScopeId = `${workflow.id}_${actionId}_branch`;
                const previousScopeId = context.scopeId;
                context.scopeId = branchScopeId;
                queue.unshift({
                    type: 'scope-exit',
                    scopeId: branchScopeId,
                    previousScopeId,
                    then: action.next,
                });
                return await this.executeActions(workflow, context, branch.id, queue);
            } else if (action.type === 'trycatch') {
                context.workflow[actionId].result = {
                    caughtError: null,
                };
                const previousScopeId = context.scopeId;
                let shouldStop = false;

                try {
                    const tryScopeId = `${workflow.id}_${actionId}_try`;
                    context.scopeId = tryScopeId;
                    const tryBranch = (action.branches || []).find(({ value }) => value === 'try');
                    await this.executeActions(workflow, context, tryBranch.id);
                    cleanupScopedVariables(context, tryScopeId);
                    if (context.workflow.stop) shouldStop = true;
                } catch (error) {
                    if (context.workflow.stop) shouldStop = true;
                    context.workflow[actionId].result.caughtError = {
                        name: error.name,
                        message: error.message,
                        cause: error.cause,
                    };
                    const catchScopeId = `${workflow.id}_${actionId}_catch`;
                    context.scopeId = catchScopeId;
                    const catchBranch = (action.branches || []).find(({ value }) => value === 'catch');
                    if (catchBranch) {
                        await this.executeActions(workflow, context, catchBranch.id);
                    }
                    cleanupScopedVariables(context, catchScopeId);
                    if (context.workflow.stop) shouldStop = true;
                } finally {
                    const finallyScopeId = `${workflow.id}_${actionId}_finally`;
                    context.scopeId = finallyScopeId;
                    const finallyBranch = (action.branches || []).find(({ value }) => value === 'finally');
                    if (finallyBranch) {
                        await this.executeActions(workflow, context, finallyBranch.id);
                    }
                    cleanupScopedVariables(context, finallyScopeId);
                    context.scopeId = previousScopeId;
                    if (context.workflow.stop) shouldStop = true;
                    context.workflow.stop = shouldStop;
                }
                if (context.workflow.stop) return context.workflow[actionId].result;
                return await this.executeActions(workflow, context, action.next, queue);
            } else if (action.next) {
                return await this.executeActions(workflow, context, action.next, queue);
            } else if (queue.length) {
                return await this.executeActions(workflow, context, queue.shift(), queue);
            }
            return context.workflow[actionId].result;
        } catch (err) {
            throw err;
        }
    },

    async execute(workflow, context, socketId = null) {
        const previousDebugExecutionId = context.debugExecutionId;
        context.debugExecutionId = crypto.randomUUID();
        try {
            context.workflow = context.previousResults || {};
            context.workflow.variables ||= {};
            context.workflowDefinition = workflow;
            context.callstack?.push(workflow.id);
            if (process.env.ENV === 'editor') context.socketId = socketId ?? context.socketId;

            if (context.awaitCompletion) {
                // Jobs and nested calls must wait for traversal, not HTTP response readiness.
                delete context.jobReturnValue;
                context.returnResult = result => {
                    context.jobReturnValue = result;
                };

                const result = await this.executeActions(workflow, context, workflow.firstAction);

                return Object.hasOwn(context, 'jobReturnValue') ? context.jobReturnValue : result;
            }

            if (process.env.ENV === 'editor') {
                const result = await this.executeActions(workflow, context, workflow.firstAction);
                if (context.stream) context.streamResolve();
                return context.resultActionId ? context.workflow[context.resultActionId].result : result;
            } else {
                const result = await new Promise((resolve, reject) => {
                    context.returnResult = resolve;
                    this.executeActions(workflow, context, workflow.firstAction).then(resolve).catch(reject);
                });
                if (context.stream) context.streamResolve();
                return result;
            }
        } catch (err) {
            if (context.stream) context.streamReject(err);
            if (context.throwError) context.throwError(err);
            else throw err;
        } finally {
            wewebService.finalizeWorkflowDebug(workflow, context, socketId ?? context.socketId);
            context.debugExecutionId = previousDebugExecutionId;
        }
    },
};
