 
import { buildEditorRequestHeaders, buildRequestPayload, requestWithOptionalSSE } from './editorRequests.ts';
import { isFile, normalizeFiles } from './filePayload.js';
import { getValue } from './customCode.js';
import { convertErrorToObject } from './workflows.js';

export function getServerUrl() {
     return `${window.location.origin}/`;
}

export function getApiPath() {
    return '/api';
}

const MULTIPART_BODY_SIZE_LIMIT = 6 * 1024 * 1024;
const MULTIPART_BOUNDARY_SIZE_ESTIMATE = 128;
const textEncoder = new TextEncoder();

function buildMultipartBody(parameters = {}, fileParameters = []) {
    const fileParameterNames = new Set(fileParameters.map(fileParameter => fileParameter.name));
    const formData = new FormData();

    for (const key in parameters) {
        if (!Object.hasOwn(parameters, key)) continue;
        if (!fileParameterNames.has(key)) {
            formData.append(key, JSON.stringify(parameters[key]));
        }
    }

    for (const fileParameter of fileParameters) {
        const paramValue = parameters[fileParameter.name];
        if (!paramValue) continue;

        if (fileParameter.multiple) {
            const normalizedFiles = normalizeFiles(paramValue);

            for (const [index, file] of normalizedFiles.entries()) {
                if (!isFile(file)) continue;
                formData.append(`fileParam[${index}]-${fileParameter.name}`, file);
            }
            continue;
        }

        const normalizedFiles = normalizeFiles(paramValue);
        if (!normalizedFiles.length) continue;
        formData.append(`fileParam-${fileParameter.name}`, normalizedFiles[0]);
    }

    return formData;
}

function supportsFilePayloadMethod(method = 'POST') {
    const methodUpper = method.toUpperCase();
    return methodUpper === 'POST' || methodUpper === 'PUT' || methodUpper === 'PATCH';
}

function hasFilePayload(parameters = {}, fileParameters = []) {
    return fileParameters.some(fileParameter => normalizeFiles(parameters[fileParameter.name]).length > 0);
}

function assertMultipartBodySize(formData) {
    const size = estimateMultipartBodySize(formData);
    if (size <= MULTIPART_BODY_SIZE_LIMIT) return;

    const error = new Error(
        `Backend workflow uploads are limited to 6 MB. Current request size: ${(size / (1024 * 1024)).toFixed(2)} MB.`
    );
    error.status = 413;
    error.code = 'PAYLOAD_TOO_LARGE';
    throw error;
}

function estimateMultipartBodySize(formData) {
    let size = MULTIPART_BOUNDARY_SIZE_ESTIMATE + 6;

    for (const [key, value] of formData.entries()) {
        size += MULTIPART_BOUNDARY_SIZE_ESTIMATE + 4;
        if (isFile(value)) {
            size += textEncoder.encode(
                `Content-Disposition: form-data; name="${key}"; filename="${value.name}"\r\n`
            ).length;
            size += textEncoder.encode(`Content-Type: ${value.type || 'application/octet-stream'}\r\n\r\n`).length;
            size += value.size;
            size += 2;
            continue;
        }

        size += textEncoder.encode(`Content-Disposition: form-data; name="${key}"\r\n\r\n`).length;
        size += textEncoder.encode(value).length;
        size += 2;
    }

    return size;
}

function buildWorkflowRequestPayload(method, parameters, fileParameters, shouldBuildMultipartBody) {
    const body = shouldBuildMultipartBody ? buildMultipartBody(parameters, fileParameters) : undefined;
    if (body) assertMultipartBodySize(body);

    return buildRequestPayload({
        method,
        parameters,
        body,
    });
}

function resolveParameterVariableReferences(parameters = {}, parameterNames = [], context = {}) {
    const variablesStore = wwLib.store.variables;
    const resolvedParameters = { ...parameters };

    for (const key of parameterNames) {
        if (!Object.hasOwn(resolvedParameters, key)) continue;
        const value = resolvedParameters[key];
        if (typeof value !== 'string') continue;
        if (!value.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)) continue;

        const isInternalVariable = context?.component?.componentVariablesConfiguration?.[value];
        const resolvedValue = isInternalVariable
            ? context?.component?.variables?.[value]
            : variablesStore.values[value];
        if (!resolvedValue) continue;
        resolvedParameters[key] = resolvedValue;
    }

    return resolvedParameters;
}

function resolveEditorWorkflowParameters(parameters = {}, fileParameters = [], fileMetaParameters = [], context = {}) {
    const variablesStore = wwLib.store.variables;
    const resolvedParameters = { ...parameters };

    for (const fileParam of [...fileParameters, ...fileMetaParameters]) {
        if (!Object.hasOwn(resolvedParameters, fileParam.name)) continue;

        if (
            typeof resolvedParameters[fileParam.name] === 'string' &&
            resolvedParameters[fileParam.name].match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
        ) {
            const id = resolvedParameters[fileParam.name];
            const isInternalVariable = context?.component?.componentVariablesConfiguration?.[id];
            const actionValue = isInternalVariable ? context?.component?.variables[id] : variablesStore.values[id];
            if (actionValue) {
                resolvedParameters[fileParam.name] = actionValue;
            }
        }

        if (!fileParam.multiple && Array.isArray(resolvedParameters[fileParam.name])) {
            resolvedParameters[fileParam.name] = resolvedParameters[fileParam.name][0];
        }
    }

    for (const fileMetaParam of fileMetaParameters) {
        if (fileMetaParam.multiple) {
            resolvedParameters[fileMetaParam.name] = resolvedParameters[fileMetaParam.name]?.map(file => ({
                size: file?.size,
                type: file?.type,
                name: file?.name,
                lastModified: file?.lastModified,
            }));
        } else if (Array.isArray(resolvedParameters[fileMetaParam.name])) {
            const [file] = resolvedParameters[fileMetaParam.name];
            resolvedParameters[fileMetaParam.name] = file
                ? {
                      size: file.size,
                      type: file.type,
                      name: file.name,
                      lastModified: file.lastModified,
                  }
                : undefined;
        } else if (resolvedParameters[fileMetaParam.name]) {
            resolvedParameters[fileMetaParam.name] = {
                size: resolvedParameters[fileMetaParam.name].size,
                type: resolvedParameters[fileMetaParam.name].type,
                name: resolvedParameters[fileMetaParam.name].name,
                lastModified: resolvedParameters[fileMetaParam.name].lastModified,
            };
        }
    }

    return resolvedParameters;
}

function resolveEditorTestParameters(parameters = {}, workflowParameters = []) {
    const resolvedParameters = { ...parameters };

    for (const parameter of Object.values(workflowParameters || {})) {
        if (!parameter?.name || !Object.hasOwn(resolvedParameters, parameter.name)) continue;
        resolvedParameters[parameter.name] = getValue(resolvedParameters[parameter.name]);
    }

    return resolvedParameters;
}

 
export async function executeBackendWorkflow(workflowId, parameters = {}, options = {}, context = {}) {
    let workflows,
        workflow = null;
 
    /* wwFront:start */
    // eslint-disable-next-line no-unreachable
    workflows = Object.values(wwLib.store.data.backendWorkflows);
    workflow = workflows.find(w => w.id === workflowId);
    const headers = options.headers || {};
    let path = `/ww/workflows/${workflowId}`;
    const method = workflow?.meta?.method || 'POST';
    const methodUpper = method.toUpperCase();
    const methodSupportsFilePayload = supportsFilePayloadMethod(methodUpper);
    const fileParameters = methodSupportsFilePayload
        ? Object.values(workflow?.parameters || {}).filter(parameter => parameter.type === 'file')
        : [];
    const fileOrMetaParameterNames = methodSupportsFilePayload
        ? Object.values(workflow?.parameters || {})
              .filter(parameter => ['file', 'file-meta'].includes(parameter.type))
              .map(parameter => parameter.name)
        : [];
    const resolvedParameters = resolveParameterVariableReferences(parameters, fileOrMetaParameterNames, context);
    const shouldBuildMultipartBody = methodSupportsFilePayload && hasFilePayload(resolvedParameters, fileParameters);

    if (workflow?.meta?.path) {
        path = workflow.meta.path.replace(/\{(\w+)\}/g, (match, paramName) => {
            const value = resolvedParameters[paramName];
            return typeof value === 'string' || typeof value === 'number' ? value : match;
        });
    }
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const requestPath = normalizedPath;
    // eslint-disable-next-line no-unreachable
    try {
        const requestPayload = await buildWorkflowRequestPayload(
            method,
            resolvedParameters,
            fileParameters,
            shouldBuildMultipartBody
        );
        const requestOptions = {
            method,
            headers,
            ...requestPayload,
        };
        const response = await requestWithOptionalSSE({
            url: requestPath,
            requestOptions,
            stream: options.__wwstream === true,
        });

        return response;
    } catch (error) {
        error.data = error?.error;
        delete error.error;
        delete error.cause;
        throw error;
    }

    /* wwFront:end */
}

/**
 * Parses a Server-Sent Events (SSE) stream and yields parsed events as an async generator
 * @param {ReadableStream} stream - Any iterable stream
 * @yields {Object} { data, event } - Parsed SSE event
 */
export async function* parseSSEStreamAsync(stream) {
    const decoder = new TextDecoder();
    let buffer = '';

    function parseEventBlock(eventBlock) {
        const lines = eventBlock.split('\n');
        const currentEvent = { type: 'message', data: '' };

        for (const line of lines) {
            if (line.startsWith('event:')) {
                currentEvent.type = line.slice(6).trim();
            } else if (line.startsWith('data:')) {
                const data = line.slice(5).trim();
                currentEvent.data += (currentEvent.data ? '\n' : '') + data;
            }
        }

        if (!currentEvent.data) return null;

        try {
            return { data: JSON.parse(currentEvent.data), event: currentEvent.type };
        } catch (e) {
            return { data: currentEvent.data, event: currentEvent.type };
        }
    }

    for await (const chunk of stream) {
        // Decode the chunk and add to buffer
        buffer += decoder.decode(chunk, { stream: true });

        // Process complete SSE events (events end with \n\n)
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || ''; // Keep incomplete event in buffer

        for (const eventBlock of parts) {
            if (!eventBlock.trim()) continue;
            const parsedEvent = parseEventBlock(eventBlock);
            if (parsedEvent) yield parsedEvent;
        }
    }

    if (!buffer.trim()) return;
    const parsedEvent = parseEventBlock(buffer);
    if (parsedEvent) yield parsedEvent;
}
