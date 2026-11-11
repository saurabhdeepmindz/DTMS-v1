import { CAPTURE_LIMITS, captureBounded, createNodeBudget, utf8ByteLength, normalizeDiagnosticText, type CaptureResult } from './boundedCapture.ts';

// Persisted remote workflow log (WW-6080): the whole UTF-8 JSON body stays within maxBytes.
export const ENVELOPE_LIMITS = Object.freeze({
    maxBytes: 64 * 1024,
    logsBytes: 40 * 1024,
    contextBytes: 8 * 1024,
    errorsBytes: 8 * 1024,
    maxIdentifierLength: 255,
    maxErrorSummaryLength: 1024,
});

// Errors get their own node reserve so large values can never crowd them out.
const ERROR_NODES = 256;
const CONTEXT_NODES = 512;
// Room kept free for the sender's omission report, added just before sending.
const SENDER_REPORT_BYTES = 256;
// Upper bound of top-level log entries (one per action) scanned for action errors.
const MAX_SCANNED_ACTIONS = 1000;
const ERROR_FIELDS = ['name', 'message', 'code', 'status', 'statusCode', 'stack'];

export type WorkflowLogInput = {
    id?: string;
    designId: string;
    workflowId: string;
    traceId: string;
    type: string;
    origin: 'front' | 'back';
    logs: unknown;
    // Already whitelisted by the producer: never pass the full workflow context or authentication material.
    context: Record<string, unknown>;
    errors: unknown[];
};

export type EncodedWorkflowLog = { id: string; designId: string; body: string; bytes: number; hasError: boolean };

export type SenderReport = { dropped: number; droppedErrors: number; failed: number; failedErrors: number };

function boundIdentifier(value: unknown): string {
    const text = typeof value === 'string' ? value : '';
    return normalizeDiagnosticText(text.slice(0, ENVELOPE_LIMITS.maxIdentifierLength));
}

function dropTrailingHighSurrogate(text: string): string {
    const last = text.charCodeAt(text.length - 1);
    return last >= 0xd800 && last <= 0xdbff ? text.slice(0, -1) : text;
}

function read(source: unknown, key: string): unknown {
    try {
        return (source as Record<string, unknown> | null | undefined)?.[key];
    } catch {
        return undefined;
    }
}

// Only whitelisted fields: error objects often carry request configs with credentials.
function normalizeError(error: unknown, actionId?: string): Record<string, unknown> {
    const normalized: Record<string, unknown> = actionId ? { actionId } : {};
    if (error === null || typeof error !== 'object') {
        normalized.message = error;
        return normalized;
    }
    for (const field of ERROR_FIELDS) {
        const value = read(error, field);
        if (value !== undefined) normalized[field] = value;
    }
    const cause = read(error, 'cause');
    if (cause && typeof cause === 'object') {
        normalized.cause = { name: read(cause, 'name'), message: read(cause, 'message') };
    } else if (cause !== undefined) {
        normalized.cause = cause;
    }
    return normalized;
}

function collectActionErrors(logs: unknown): Record<string, unknown>[] {
    const errors: Record<string, unknown>[] = [];
    if (!logs || typeof logs !== 'object') return errors;
    let scanned = 0;
    for (const actionId in logs) {
        if (scanned++ >= MAX_SCANNED_ACTIONS || errors.length >= CAPTURE_LIMITS.maxErrors) break;
        const error = read(read(logs, actionId), 'error');
        if (error != null) errors.push(normalizeError(error, actionId));
    }
    return errors;
}

function summarize(errors: unknown): string | undefined {
    const first = Array.isArray(errors) ? errors[0] : undefined;
    if (!first) return undefined;
    const name = typeof first.name === 'string' ? first.name : 'Error';
    const message = typeof first.message === 'string' ? first.message : '';
    return dropTrailingHighSurrogate(`${name}: ${message}`.slice(0, ENVELOPE_LIMITS.maxErrorSummaryLength));
}

function asObject(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : { value };
}

function buildDiagnostics(sections: Record<string, CaptureResult>) {
    const reasons: Record<string, number> = {};
    const truncations: Record<string, unknown>[] = [];
    let truncationCount = 0;
    let nodes = 0;
    for (const section in sections) {
        const result = sections[section];
        nodes += result.nodes;
        truncationCount += result.truncationCount;
        for (const reason in result.reasons) reasons[reason] = (reasons[reason] || 0) + result.reasons[reason];
        for (const entry of result.truncations) {
            if (truncations.length >= CAPTURE_LIMITS.maxTruncations) break;
            truncations.push({ section, ...entry });
        }
    }
    return { version: 1, truncated: truncationCount > 0, nodes, truncationCount, reasons, truncations };
}

function encode(envelope: object): { body: string; bytes: number } {
    const body = JSON.stringify(envelope);
    return { body, bytes: utf8ByteLength(body) };
}

// Synchronous and bounded; callers should still treat a throw as a dropped diagnostic.
/** @param {{ includeLogs?: boolean }} [options] */
export function encodeWorkflowLogEnvelope(input: WorkflowLogInput, { includeLogs = true }: { includeLogs?: boolean } = {}): EncodedWorkflowLog {
    const actionErrors = collectActionErrors(input.logs);
    const workflowErrors = (input.errors || []).slice(0, CAPTURE_LIMITS.maxErrors).map(error => normalizeError(error, boundIdentifier(read(error, 'actionId')) || undefined));
    const allErrors = [...workflowErrors, ...actionErrors].slice(0, CAPTURE_LIMITS.maxErrors);

    const errors = captureBounded(allErrors, {
        maxBytes: ENVELOPE_LIMITS.errorsBytes,
        budget: createNodeBudget(ERROR_NODES),
        maxDepth: 3,
    });
    const logs = includeLogs
        ? captureBounded(input.logs ?? {}, { maxBytes: ENVELOPE_LIMITS.logsBytes, budget: createNodeBudget(CAPTURE_LIMITS.maxNodes - ERROR_NODES - CONTEXT_NODES), maxArrayItems: 20 })
        : { value: {}, bytes: 2, nodes: 0, truncationCount: 0, reasons: {}, truncations: [] };
    const context = captureBounded(input.context ?? {}, {
        maxBytes: ENVELOPE_LIMITS.contextBytes,
        budget: createNodeBudget(CONTEXT_NODES),
        maxArrayItems: 10,
    });
    const diagnostics = buildDiagnostics({ errors, logs, context });
    const hasError = allErrors.length > 0;

    const envelope = {
        id: input.id ?? globalThis.crypto.randomUUID(),
        designId: boundIdentifier(input.designId),
        workflowId: boundIdentifier(input.workflowId),
        traceId: boundIdentifier(input.traceId),
        type: boundIdentifier(input.type),
        origin: input.origin,
        hasError,
        errorSummary: summarize(errors.value),
        logs: asObject(logs.value),
        context: { ...asObject(context.value), errors: errors.value, diagnostics },
    };
    let encoded = encode(envelope);
    if (encoded.bytes > ENVELOPE_LIMITS.maxBytes - SENDER_REPORT_BYTES) {
        // Only reachable with pathological identifiers; errors and diagnostics win over values.
        diagnostics.reasons.envelope = 1;
        encoded = encode({ ...envelope, logs: {}, context: { errors: errors.value, diagnostics } });
    }
    return { id: envelope.id, designId: envelope.designId, body: encoded.body, bytes: encoded.bytes, hasError };
}

// Records sender omissions inside the persisted context; returns the original body if it would not fit.
/** @param {number} [maxBytes] */
export function withSenderReport(body: string, report: SenderReport, maxBytes: number = ENVELOPE_LIMITS.maxBytes): string {
    try {
        const envelope = JSON.parse(body);
        if (!envelope?.context?.diagnostics) return body;
        envelope.context.diagnostics.sender = report;
        const annotated = JSON.stringify(envelope);
        return utf8ByteLength(annotated) <= maxBytes ? annotated : body;
    } catch {
        return body;
    }
}
