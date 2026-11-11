import type { ResponseContext } from '@better-fetch/fetch';

type RequestHeaders = Record<string, unknown>;
type LateResponse = {
    __wwLateResponse: true;
    status?: number;
    headers?: Record<string, string>;
    contentType?: string;
    body?: unknown;
    bodyEncoding?: 'base64';
};

function sanitizeHeaders(headers: RequestHeaders = {}) {
    const sanitizedHeaders: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
        if (value === undefined || value === null) continue;
        sanitizedHeaders[key] = typeof value === 'string' ? value : `${value}`;
    }
    return sanitizedHeaders;
}

export function buildEditorRequestHeaders({
    isTest = false,
    headers = {},
    actionId = null,
    encodedPreviousResults = null,
    env = null,
}: {
    isTest?: boolean;
    headers?: RequestHeaders;
    actionId?: string | null;
    encodedPreviousResults?: string | null;
    env?: string | null;
} = {}) {
    const baseHeaders: RequestHeaders = {
        'ww-socket-id': wwLib.$socket?.id,
        'ww-editor-user-id': wwLib.store.manager.user?.id,
        'ww-editor-test': isTest ? 'true' : 'false',
        ...(actionId ? { 'ww-editor-action-id': actionId } : {}),
        ...(encodedPreviousResults ? { 'ww-editor-previous-results': encodedPreviousResults } : {}),
        ...(env ? { 'ww-editor-env': env } : {}),
        ...headers,
    };

    return sanitizeHeaders(baseHeaders);
}

export function buildRequestPayload({
    method,
    parameters = {},
    body,
}: {
    method?: string;
    parameters?: Record<string, unknown>;
    body?: unknown;
}) {
    const methodUpper = method?.toUpperCase() || 'POST';
    if (methodUpper === 'GET' || methodUpper === 'DELETE') {
        return { query: { ...parameters } };
    }

    return { body: body ?? parameters };
}

function isLateResponse(value: unknown): value is LateResponse {
    return !!value && typeof value === 'object' && (value as LateResponse).__wwLateResponse === true;
}

function decodeBase64Body(body: unknown, contentType?: string) {
    if (typeof body !== 'string' || typeof globalThis.atob !== 'function') return body;

    const binary = globalThis.atob(body);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) {
        bytes[index] = binary.charCodeAt(index);
    }

    if (typeof globalThis.Blob === 'function') {
        return new Blob([bytes], { type: contentType || 'application/octet-stream' });
    }

    return bytes;
}

function getLateResponseBody(response: LateResponse) {
    if (response.bodyEncoding === 'base64') {
        return decodeBase64Body(response.body, response.contentType);
    }

    return response.body;
}

function unwrapLateResponse<T>(value: T | LateResponse): T {
    if (!isLateResponse(value)) return value as T;

    const status = value.status || 200;
    const body = getLateResponseBody(value);
    if (status < 400) return body as T;

    const message =
        body && typeof body === 'object' && 'message' in body
            ? String(body.message)
            : `Request failed with status ${status}`;
    const error = new Error(message) as Error & {
        status?: number;
        error?: unknown;
        headers?: Record<string, string>;
        response?: LateResponse;
    };
    error.status = status;
    error.error = body;
    error.headers = value.headers;
    error.response = value;
    throw error;
}

export async function requestWithOptionalSSE<T = unknown>({
    url,
    requestOptions = {},
    stream = false,
}: {
    url: string;
    requestOptions?: WwServerRequestOptions<T>;
    stream?: boolean;
}): Promise<T | ReadableStream<Uint8Array> | null> {
    const existingHookOptions = requestOptions.hookOptions;
    const existingOnResponse = requestOptions.onResponse;

    const hookOptions = stream ? { ...existingHookOptions, cloneResponse: true } : existingHookOptions;

    return await new Promise((resolve, reject) => {
        wwServerClient<T>(url, {
            ...requestOptions,
            ...(hookOptions ? { hookOptions } : {}),
            onResponse: async (context: ResponseContext) => {
                const contentType = context.response.headers.get('content-type');
                const isSSE = contentType?.includes('text/event-stream');
                if (isSSE && stream) {
                    resolve(context.response?.body);
                    return null;
                }

                if (existingOnResponse) {
                    return await existingOnResponse(context);
                }

                return context.response;
            },
        })
            .then(value => resolve(unwrapLateResponse<T>(value)))
            .catch(reject);
    });
}
