import { HTTPException } from 'hono/http-exception';
import { prepareWorkflowExecution } from '../../services/workflowExecution.service.ts';
import { getConnections } from '../../services/connection.service.js';
import workflowCore from '../../core/workflow.core.js';
import wewebService from '../../services/weweb.service.js';
import { getCookie } from 'hono/cookie';
import { inflateSync } from 'node:zlib';
import { assertAccessRules, executeAccessMiddlewares, getAccessMiddlewareResult } from '../shared/accessControl.ts';
import hooksCore from '../../core/hooks.core.js';
import { applyDebugAuth } from '../../middlewares/auth.middlewares.js';
import { executeWithLateResponse, normalizeWorkflowPath } from './lateResponse.ts';
import { executeWithWorkflowStream, isWorkflowStreamMode } from './workflowStream.ts';

function executeWorkflowUntilResponse(workflow, context, { socketId = null, debug = false } = {}) {
    return new Promise((resolve, reject) => {
        if (!debug) context.sendResponse = resolve;
        context.throwError = reject;
        // Execution can outlive an early response. Handle its rejection even after the response settles.
        workflowCore.execute(workflow, context, socketId).then(resolve, reject);
    });
}

function decodePreviousResults(encodedPreviousResults) {
    if (!encodedPreviousResults) return null;

    try {
        const compressedValue = Buffer.from(encodedPreviousResults, 'base64');
        const serializedValue = inflateSync(compressedValue).toString('utf-8');
        const parsedValue = JSON.parse(serializedValue);
        if (!parsedValue || typeof parsedValue !== 'object') return null;
        return parsedValue;
    } catch (error) {
        return null;
    }
}

export const executeEditorWorkflow = async c => {
    const method = c.req.method;
    const rawPath = c.req.path;
    const path = normalizeWorkflowPath(rawPath);
    const socketId = c.req.header('ww-socket-id');
    const debug = c.req.header('ww-debug') === 'true';
    const isTest = c.req.header('ww-editor-test') === 'true';
    const testActionId = c.req.header('ww-editor-action-id');
    const previousResults = decodePreviousResults(c.req.header('ww-editor-previous-results'));

    const editorUserId = c.req.header('ww-editor-user-id');
    const options = { socketId, editorUserId };
    const matchResult = await wewebService.matchWorkflowByPath(method, path, options);

    if (!matchResult) {
        throw new HTTPException(404);
    }

    const { workflow, subWorkflows, pathParams } = matchResult;
    if (!workflow) {
        throw new HTTPException(404);
    }

    c.set('workflow', workflow);

    if (testActionId && workflow.actions?.[testActionId]) {
        workflow.firstAction = testActionId;
        workflow.actions[testActionId].next = null;
        workflow.actions[testActionId].branches = [];
    }

    const workflowContext = await prepareEditorContext(
        c,
        { ...matchResult, workflows: Object.values(subWorkflows || {}) },
        pathParams,
        previousResults
    );

    const executeAccess = async () => {
        if (isTest) return null;

        assertAccessRules(workflow.meta?.security, workflowContext.auth, { detailedErrors: true });
        return await executeAccessMiddlewares(
            workflow.meta?.security,
            workflowContext.workflows,
            workflowContext,
            socketId
        );
    };

    const executeWorkflow = async () => {
        try {
            const result = await executeWorkflowUntilResponse(workflow, workflowContext, { socketId, debug });

            if (debug) {
                const body = { debug: wewebService.sanitizeWorkflowDebugResults(workflowContext.workflow) };
                if (workflowContext.lateResponseStarted) return body;
                return c.json(body);
            }
            if (workflowContext.lateResponseStarted) return result;
            else if (result instanceof Response) return result;
            else if (c.res) return c.res;
            else return c.json(result);
        } catch (err) {
            if (debug) {
                const status = err?.status || err?.statusCode || 500;
                const body = {
                    debug: { results: wewebService.sanitizeWorkflowDebugResults(workflowContext.workflow) },
                };
                if (workflowContext.lateResponseStarted) {
                    workflowContext.workflowResponse = {
                        metadata: { status, contentType: 'application/json', body, headers: {} },
                    };
                    return body;
                }
                return c.json(body, { status });
            }
            throw err instanceof Error ? err : Object.assign(new Error(err?.message || 'Internal Server Error'), err);
        }
    };

    if (!debug && isWorkflowStreamMode(workflow, workflowContext.workflows)) {
        const middlewareTermination = await executeAccess();
        if (middlewareTermination) return getAccessMiddlewareResult(middlewareTermination);

        return executeWithWorkflowStream(c, workflowContext, executeWorkflow);
    }

    return executeWithLateResponse(c, workflowContext, async () => {
        const middlewareTermination = await executeAccess();
        if (middlewareTermination) return getAccessMiddlewareResult(middlewareTermination);

        return await executeWorkflow();
    });
};

export const executeWorkflow = async c => {
    const workflow = c.get('workflow');
    const workflowContext = await prepareContext(c);

    const executeAccess = async () => {
        assertAccessRules(workflow.meta?.security, workflowContext.auth, { detailedErrors: true });
        return await executeAccessMiddlewares(workflow.meta?.security, workflowContext.workflows, workflowContext);
    };

    const executeWorkflow = async () => {
        try {
            const result = await executeWorkflowUntilResponse(workflow, workflowContext);

            if (workflowContext.lateResponseStarted) return result;
            if (result instanceof Response) return result;
            else if (c.res) return c.res;
            else return c.json(result);
        } catch (err) {
            throw err instanceof Error ? err : Object.assign(new Error(err?.message || 'Internal Server Error'), err);
        }
    };

    if (isWorkflowStreamMode(workflow, workflowContext.workflows)) {
        const middlewareTermination = await executeAccess();
        if (middlewareTermination) return getAccessMiddlewareResult(middlewareTermination);

        return executeWithWorkflowStream(c, workflowContext, executeWorkflow);
    }

    return executeWithLateResponse(c, workflowContext, async () => {
        const middlewareTermination = await executeAccess();
        if (middlewareTermination) return getAccessMiddlewareResult(middlewareTermination);

        return await executeWorkflow();
    });
};

// Debug endpoint: runs a workflow to inspect it and returns { workflowResult, actionsResults }.
// It never delivers the workflow's HTTP response, so it stays isolated from the real request path.
export const executeDebugWorkflow = async c => {
    const {
        path,
        method = 'POST',
        parameters = {},
        headers = {},
        auth,
        event,
        actionId,
        previousResults = null,
        socketId = null,
        editorUserId = null,
    } = await c.req.json().catch(() => ({}));

    // Path-based: matchWorkflowByPath also resolves the dependent subWorkflows, and ww-api workflows are
    // only registered under their meta.path.
    const matchResult = await wewebService.matchWorkflowByPath(method, path, { socketId, editorUserId });
    if (!matchResult?.workflow) {
        throw new HTTPException(404);
    }

    const { workflow, subWorkflows, pathParams } = matchResult;

    if (actionId && workflow.actions?.[actionId]) {
        workflow.firstAction = actionId;
        workflow.actions[actionId].next = null;
        workflow.actions[actionId].branches = [];
    }

    // Run as a user: `session` (integration session object) or `userId` (WeWeb Auth mock hook).
    if (auth && Object.keys(auth).length) {
        try {
            await applyDebugAuth(c, auth);
        } catch (err) {
            return c.json({
                workflowResult: null,
                error: { name: 'MockAuthError', message: err?.message || 'Failed to run as the requested user.' },
                actionsResults: {},
            });
        }
    }

    const workflowContext = prepareDebugContext(c, {
        path,
        method,
        parameters,
        headers,
        event,
        pathParams,
        previousResults,
        executionData: { ...matchResult, workflows: Object.values(subWorkflows || {}) },
    });

    let result = null;
    let error;
    try {
        result = await workflowCore.execute(workflow, workflowContext, socketId);
    } catch (err) {
        error = { name: err?.name, message: err?.message };
    }

    const workflowResult = workflowContext.response ?? (result instanceof Response ? null : result);
    const body = JSON.stringify({
        workflowResult,
        ...(error ? { error } : {}),
        actionsResults: wewebService.sanitizeWorkflowDebugResults(workflowContext.workflow),
    });
    // A return-response action may have finalized c.res; discard it and return the debug payload.
    c.res = new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
    return c.res;
};

function prepareDebugContext(
    c,
    {
        path,
        method = 'POST',
        parameters = {},
        headers = {},
        event,
        pathParams = {},
        previousResults = null,
        executionData,
    }
) {
    const isGetOrDelete = ['GET', 'DELETE'].includes(method.toUpperCase());

    return {
        env: c.req.header('ww-editor-env') || 'editor',
        http: {
            method,
            query: isGetOrDelete ? parameters : {},
            body: isGetOrDelete ? {} : parameters,
            // Only the mocked headers — never the internal request's (they carry the project secret).
            headers: new Headers(headers),
            cookies: {},
            path,
            pathParams,
        },
        auth: {
            user: c.get('user'),
            session: c.get('session'),
            isAuthenticated: !!c.get('user'),
        },
        // Credentials changed in the editor apply at once, over those the workflow match carries.
        ...prepareWorkflowExecution({ ...executionData, connections: getConnections(executionData.connections) }),
        parameters: { ...pathParams, ...parameters },
        event,
        previousResults,
        honoContext: c,
        response: null,
    };
}

async function prepareContext(c) {
    const method = c.req.method;
    const isGetOrDelete = ['GET', 'DELETE'].includes(method.toUpperCase());
    const query = c.req.query();
    const body = await parseRequestBody(c, isGetOrDelete);
    const headers = c.req.raw.headers;
    const cookies = getCookie(c);
    const path = c.req.path;

    return {
        http: { method, query, body, headers, cookies, path },
        auth: {
            user: c.get('user'),
            session: c.get('session'),
            isAuthenticated: !!c.get('user'),
        },
        ...prepareWorkflowExecution(),
        parameters: isGetOrDelete ? query : body,
        previousResults: null,
        honoContext: c,
        workflowResponse: null,
    };
}

async function prepareEditorContext(c, executionData, pathParams = {}, previousResults = null) {
    const method = c.req.method;
    const isGetOrDelete = ['GET', 'DELETE'].includes(method.toUpperCase());
    const query = c.req.query();
    const headers = c.req.raw.headers;
    const cookies = getCookie(c);
    const path = c.req.path;
    const body = await parseRequestBody(c, isGetOrDelete);
    const traceId = c.req.header('ww-editor-trace-id');

    const parameters = { ...pathParams, ...(isGetOrDelete ? query : body) };

    return {
        env: c.req.header('ww-editor-env') || 'editor',
        http: { method, query, body, headers, cookies, path, pathParams },
        auth: {
            user: c.get('user'),
            session: c.get('session'),
            isAuthenticated: !!c.get('user'),
        },
        // Credentials changed in the editor apply at once, over those the workflow match carries.
        ...prepareWorkflowExecution({ ...executionData, connections: getConnections(executionData.connections) }),
        parameters,
        previousResults,
        honoContext: c,
        traceId: traceId || crypto.randomUUID(),
        callstack: [],
        workflowResponse: null,
    };
}

async function parseRequestBody(c, isGetOrDelete) {
    if (isGetOrDelete) return null;
    const contentType = c.req.header('content-type') || '';
    if (!contentType.includes('multipart/form-data') && !contentType.includes('application/x-www-form-urlencoded')) {
        return await c.req.json().catch(() => ({}));
    }

    const formData = await c.req.formData().catch(() => null);
    if (!formData) return {};

    return parseFormDataBody(formData);
}

function parseFormDataBody(formData) {
    const formDataEntries = Object.fromEntries(formData.entries());
    const body = {};
    const filesSet = [];

    for (const key in formDataEntries) {
        if (!Object.hasOwn(formDataEntries, key)) continue;
        if (key.startsWith('fileParam[')) {
            const keyParam = key.replace(/fileParam\[[^\]]*\]-/, '');
            const file = formData.get(key);
            if (!filesSet.includes(keyParam)) {
                filesSet.push(keyParam);
                body[keyParam] = [];
            }
            body[keyParam].push(file);
            continue;
        }

        if (key.startsWith('fileParam-')) {
            const keyParam = key.replace(/fileParam-/, '');
            const file = formData.get(key);
            if (!filesSet.includes(keyParam)) {
                filesSet.push(keyParam);
            }
            body[keyParam] = file;
            continue;
        }

        body[key] = parseFormField(formDataEntries[key]);
    }

    return body;
}

function parseFormField(value) {
    if (typeof value !== 'string') return value;
    try {
        return JSON.parse(value);
    } catch {
        return value;
    }
}
