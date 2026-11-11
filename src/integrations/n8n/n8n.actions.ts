import { getApiBase, getApiHeaders, getWebhookBase, buildQueryString, clampLimit } from './n8n.utils.ts';

// Runs a workflow by calling its production webhook. n8n has no public run-by-id API endpoint —
// the webhook is the only external trigger path. The webhook path/method are derived on demand
// from the workflow definition (no hidden fields).
global.registerAction('n8n/workflows-trigger', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const workflowResponse = await fetch(
        `${getApiBase(context.connection)}/workflows/${encodeURIComponent(args.workflowId)}`,
        { headers: getApiHeaders(context.connection) }
    );
    const workflow = await workflowResponse.json().catch(() => ({}));
    if (!workflowResponse.ok) {
        if (workflowResponse.status === 404) {
            throw {
                ...workflow,
                status: 404,
                message: workflow.message || `Workflow "${args.workflowId}" was not found on this n8n instance`,
            };
        }
        throw { ...workflow, status: workflowResponse.status };
    }

    const webhookNode = (workflow.nodes || []).find((node: any) => node?.type === 'n8n-nodes-base.webhook');
    if (!webhookNode) {
        throw {
            status: 400,
            message: `Workflow "${workflow.name || args.workflowId}" has no Webhook trigger node — only workflows starting with a Webhook trigger can be triggered externally`,
        };
    }
    if (!webhookNode.parameters?.path) {
        throw {
            status: 400,
            message: `The Webhook trigger node of workflow "${workflow.name || args.workflowId}" has no path configured`,
        };
    }

    // n8n's webhook node defaults to GET when httpMethod is unset — use the node's own method.
    const method = String(webhookNode.parameters.httpMethod || 'GET').toUpperCase();
    // Strip leading slashes so a "/my-path" node value can't produce /webhook//my-path. The path is
    // NOT URL-encoded: it may contain route-param segments (:name) that must stay literal.
    const webhookPath = String(webhookNode.parameters.path).replace(/^\/+/, '');
    let webhookUrl = `${getWebhookBase(context.connection)}/webhook/${webhookPath}`;

    const requestInit: { method: string; headers: Record<string, string>; body?: string } = {
        method,
        headers: { ...(args.headers || {}) },
    };
    if (method === 'GET' || method === 'HEAD') {
        // fetch forbids a request body on GET/HEAD — pass the payload as query parameters instead
        webhookUrl += buildQueryString(args.data || {});
    } else {
        requestInit.headers = { 'Content-Type': 'application/json', ...(args.headers || {}) };
        requestInit.body = JSON.stringify(args.data ?? {});
    }

    const response = await fetch(webhookUrl, requestInit);
    const text = await response.text();
    let parsed: any;
    let isJson = false;
    try {
        parsed = JSON.parse(text);
        isJson = true;
    } catch {
        // not JSON — keep raw text
    }

    if (!response.ok) {
        const errorBody = isJson && parsed && typeof parsed === 'object' ? parsed : { message: text };
        if (response.status === 404) {
            throw {
                ...errorBody,
                status: 404,
                message: [
                    errorBody.message,
                    'The webhook was not found: the workflow is likely not published (production webhooks only register once the workflow is published in n8n), or the webhook path changed.',
                ]
                    .filter(Boolean)
                    .join(' '),
            };
        }
        throw { ...errorBody, status: response.status };
    }

    return isJson ? parsed : text;
});

global.registerAction('n8n/executions-list', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const params = {
        workflowId: args.workflowId,
        status: args.status,
        limit: clampLimit(args.limit),
        cursor: args.cursor,
        includeData: args.includeData,
    };

    const response = await fetch(`${getApiBase(context.connection)}/executions${buildQueryString(params)}`, {
        headers: getApiHeaders(context.connection),
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) throw { ...data, status: response.status };
    return data;
});

global.registerAction('n8n/executions-get', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const response = await fetch(
        `${getApiBase(context.connection)}/executions/${encodeURIComponent(args.executionId)}${buildQueryString({
            includeData: args.includeData,
        })}`,
        { headers: getApiHeaders(context.connection) }
    );
    const data = await response.json().catch(() => ({}));

    if (!response.ok) throw { ...data, status: response.status };
    return data;
});
