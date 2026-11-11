import { getLateResponseTimeoutMs, getResponseStreamHeartbeatIntervalMs } from './workflowResponseConfig.ts';

const LATE_RESPONSE_SENTINEL = Symbol('late-response-timeout');

const WORKFLOW_BASE_PATHS = ['/api/stream', '/api'];

type WorkflowResponseMetadata = {
    status?: number;
    contentType?: string;
    body?: unknown;
    headers?: Record<string, unknown>;
};

type WorkflowContext = {
    workflowResponse?: {
        metadata: WorkflowResponseMetadata;
        httpResponse?: Response;
    } | null;
    lateResponseStarted?: boolean;
};

type ExecutionResult<T> = { value: T } | { error: unknown };

type LateResponseEnvelope = {
    __wwLateResponse: true;
    status: number;
    headers: Record<string, string>;
    contentType: string;
    body: unknown;
    bodyEncoding?: 'base64';
};

export function normalizeWorkflowPath(rawPath = '') {
    for (const basePath of WORKFLOW_BASE_PATHS) {
        if (rawPath === basePath) return '/';
        if (rawPath.startsWith(`${basePath}/`)) return rawPath.slice(basePath.length);
    }
    return rawPath;
}

export async function executeWithLateResponse<T>(
    c: { req: { path: string } },
    workflowContext: WorkflowContext,
    execute: () => Promise<T>
) {
    const timeoutMs = getLateResponseTimeoutMs();
    if (timeoutMs < 0) {
        return await execute();
    }

    let timeoutId: NodeJS.Timeout | undefined;
    const executionPromise = Promise.resolve().then(execute);
    const executionResultPromise: Promise<ExecutionResult<T>> = executionPromise.then(
        value => ({ value }),
        error => ({ error })
    );
    const timeoutPromise: Promise<typeof LATE_RESPONSE_SENTINEL> = new Promise(resolve => {
        timeoutId = setTimeout(() => resolve(LATE_RESPONSE_SENTINEL), timeoutMs);
    });

    const result = await Promise.race([executionResultPromise, timeoutPromise]);

    clearTimeout(timeoutId);

    if (result === LATE_RESPONSE_SENTINEL) {
        workflowContext.lateResponseStarted = true;
        return createLateResponseStream(executionPromise, workflowContext);
    }
    if ('error' in result) throw result.error;
    return result.value;
}

function createLateResponseStream(executionPromise: Promise<unknown>, workflowContext: WorkflowContext) {
    let heartbeatId: NodeJS.Timeout | null = null;
    const encoder = new TextEncoder();
    let closed = false;

    const stream = new ReadableStream({
        start(controller) {
            const enqueue = (value: string) => {
                if (closed) return;
                controller.enqueue(encoder.encode(value));
            };
            const close = () => {
                if (closed) return;
                closed = true;
                if (heartbeatId) clearInterval(heartbeatId);
                controller.close();
            };

            enqueue('\n');
            heartbeatId = setInterval(() => enqueue('\n'), getResponseStreamHeartbeatIntervalMs());

            executionPromise
                .then(async response => {
                    enqueue(await serializeLateResponse(response, workflowContext));
                    close();
                })
                .catch(error => {
                    console.error(error);
                    enqueue(JSON.stringify(createLateErrorEnvelope(error)));
                    close();
                });
        },
        cancel() {
            closed = true;
            if (heartbeatId) clearInterval(heartbeatId);
        },
    });

    return new Response(stream, {
        status: 200,
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            'X-WeWeb-Late-Response': '1',
        },
    });
}

async function serializeLateResponse(response: unknown, workflowContext: WorkflowContext) {
    if (workflowContext.workflowResponse?.metadata) {
        return serializeWorkflowResponseMetadata(workflowContext.workflowResponse.metadata);
    }

    if (response instanceof Response) {
        return await serializeResponse(response);
    }

    return JSON.stringify(response ?? null);
}

function serializeWorkflowResponseMetadata(response: WorkflowResponseMetadata) {
    const status = response.status || 200;
    const contentType = response.contentType || 'application/json';
    const headers = sanitizeHeaders(response.headers);

    if (status === 200 && isJsonContentType(contentType) && Object.keys(headers).length === 0) {
        return JSON.stringify(response.body ?? null);
    }

    return JSON.stringify({
        __wwLateResponse: true,
        status,
        headers,
        contentType,
        body: response.body ?? null,
    } satisfies LateResponseEnvelope);
}

async function serializeResponse(response: Response) {
    const status = response.status || 200;
    const headers = sanitizeHeaders(Object.fromEntries(response.headers.entries()));
    const contentType = headers['content-type'] || response.headers.get('content-type') || 'application/json';
    const hasCustomHeaders = Object.keys(headers).some(key => !['content-type', 'content-length'].includes(key));

    if (status === 200 && isJsonContentType(contentType) && !hasCustomHeaders) {
        const body = await response.text();
        return body || 'null';
    }

    const { body, bodyEncoding } = await readResponseBody(response, contentType);
    return JSON.stringify({
        __wwLateResponse: true,
        status,
        headers,
        contentType,
        body,
        ...(bodyEncoding ? { bodyEncoding } : {}),
    } satisfies LateResponseEnvelope);
}

async function readResponseBody(response: Response, contentType: string) {
    if (isJsonContentType(contentType)) {
        const text = await response.text();
        if (!text) return { body: null };
        try {
            return { body: JSON.parse(text) };
        } catch {
            return { body: text };
        }
    }

    if (isTextContentType(contentType)) {
        return { body: await response.text() };
    }

    const body = Buffer.from(await response.arrayBuffer()).toString('base64');
    return { body, bodyEncoding: 'base64' as const };
}

function sanitizeHeaders(headers: Record<string, unknown> = {}) {
    const sanitizedHeaders: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
        if (value === undefined || value === null) continue;
        sanitizedHeaders[key.toLowerCase()] = Array.isArray(value) ? value.join(', ') : `${value}`;
    }
    return sanitizedHeaders;
}

function isJsonContentType(contentType = '') {
    return contentType.includes('application/json') || contentType.includes('+json');
}

function isTextContentType(contentType = '') {
    return contentType.startsWith('text/') || contentType.includes('application/xml') || contentType.includes('+xml');
}

function createLateErrorEnvelope(error: { status?: number; statusCode?: number; message?: string; data?: unknown }): LateResponseEnvelope {
    const status = error?.status || error?.statusCode || 500;
    return {
        __wwLateResponse: true,
        status,
        headers: {},
        contentType: 'application/json',
        body:
            status < 500 && error?.data
                ? error.data
                : { message: status >= 500 ? 'Internal Server Error' : error?.message || 'Error' },
    };
}
