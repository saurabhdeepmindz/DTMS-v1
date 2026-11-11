import { isPlainObject } from '../utils/objectGuards.ts';
import { SecurityCheckError } from '../core/errors.core.js';

import { sanitizeWorkflowDebugResults } from './workflowDebugTruncation.js';
import { utf8ByteLength } from './workflowDiagnostics/boundedCapture.ts';
import { LIVE_DEBUG_SENDER_LIMITS, createLiveDebugSender } from './workflowDiagnostics/liveDebugSender.ts';
import { createWorkflowLogSender, readWorkflowLogAcknowledgement } from './workflowDiagnostics/workflowLogSender.ts';
import { withSenderReport } from './workflowDiagnostics/workflowLogEnvelope.ts';
import { encodeWorkflowFinalSnapshot, FINAL_SNAPSHOT_LIMITS } from './workflowDiagnostics/workflowFinalSnapshot.ts';

// Transient socket debug payloads may use the larger debug byte budget, so their queue holds more bytes.
const DEBUG_MAX_PENDING_BYTES = 4 * 1024 * 1024;
const MAX_ACCESS_TOKEN_LENGTH = 8 * 1024;
const MAX_LOGGED_CONNECTIONS = 50;

async function postDiagnostic(url, { headers, body, signal }) {
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body,
        signal,
    });
    if (!response.ok) throw new Error(`Diagnostic request failed with ${response.status}`);
}

function createWorkflowDebugSender() {
    return createLiveDebugSender({
        maxPendingBytes: DEBUG_MAX_PENDING_BYTES,
        transport: (item, { signal }) =>
            postDiagnostic(`${process.env.WEWEB_BACK_URL}/v2/lambda/back/workflows/${item.target}/debug`, {
                headers: {
                    'ww-project-id': process.env.WEWEB_PROJECT_ID,
                    'ww-project-secret': process.env.WEWEB_PROJECT_SECRET,
                },
                body: item.body,
                signal,
            }),
    });
}

function createFinalSnapshotSender() {
    return createWorkflowLogSender({
        limits: FINAL_SNAPSHOT_LIMITS,
        annotate: (body, report) => withSenderReport(body, report, FINAL_SNAPSHOT_LIMITS.maxEntryBytes),
        transport: async (batch, { signal }) => {
            try {
                const response = await fetch(`${process.env.WEWEB_BACK_URL}/v2/designs/${batch.target}/workflows/debug-final`, {
                    method: 'POST',
                    headers: { ...buildHeaders(), Cookie: `ww-access-token=${batch.credential}` },
                    body: batch.body,
                    signal,
                    redirect: 'manual',
                });
                const acknowledgement = await readWorkflowLogAcknowledgement(response);
                if (acknowledgement?.version === 2 && Array.isArray(acknowledgement.accepted) && acknowledgement.accepted.length === batch.ids.length && batch.ids.every(id => acknowledgement.accepted.includes(id))) {
                    for (const id of batch.ids) clearFinalFallback(id);
                }
                return acknowledgement;
            } catch (error) {
                // The normal path uploads the final once. A failed first attempt
                // falls back to the independent live queue, preserving editor UX.
                if (!batch.isRetry) triggerFinalFallback(batch.ids[0]);
                throw error;
            }
        },
    });
}

// One single-flight queue per channel, shared by every workflow and socket.
let workflowDebugSender = createWorkflowDebugSender();
let workflowLogSender = createFinalSnapshotSender();
let reportedRejections = 0;
let reportedAbandonments = 0;
let nextWarningAt = 0;
const finalFallbacks = new Map();
const FINAL_LIVE_WAIT_MS = 250;

function clearFinalFallback(id) {
    const fallback = finalFallbacks.get(id);
    if (!fallback) return;
    clearTimeout(fallback.timer);
    finalFallbacks.delete(id);
    return fallback;
}

function triggerFinalFallback(id) {
    const fallback = clearFinalFallback(id);
    if (fallback) enqueueLiveFinalSnapshot(JSON.parse(fallback.body));
}

function scheduleFinalFallback(encoded) {
    const timer = setTimeout(() => triggerFinalFallback(encoded.id), FINAL_LIVE_WAIT_MS);
    timer.unref?.();
    finalFallbacks.set(encoded.id, { body: encoded.body, timer });
}

function enqueueLiveFinalSnapshot(snapshot) {
    const body = JSON.stringify({ debugResults: snapshot.logs, socketId: snapshot.socketId, traceId: snapshot.traceId, executionId: snapshot.executionId, final: true });
    workflowDebugSender.enqueue({ target: snapshot.workflowId, body, bytes: utf8ByteLength(body), isError: snapshot.hasError });
}

export function workflowDiagnosticsStats() {
    return { workflowDebug: workflowDebugSender.getStats(), workflowLogs: workflowLogSender.getStats() };
}

export function resetWorkflowDiagnosticsForTests() {
    workflowLogSender.stop();
    for (const id of finalFallbacks.keys()) clearFinalFallback(id);
    workflowDebugSender = createWorkflowDebugSender();
    workflowLogSender = createFinalSnapshotSender();
    reportedRejections = 0;
    reportedAbandonments = 0;
    nextWarningAt = 0;
}

export async function flushWorkflowLogs({ timeoutMs = 5000 } = {}) {
    timeoutMs = Number.isFinite(timeoutMs) ? Math.max(0, timeoutMs) : 0;
    const deadline = Date.now() + timeoutMs;
    // Give live delivery part of short HTTP completion budgets while storage
    // is still in flight. Successful acknowledgements cancel their fallback.
    const fallbackTimer = setTimeout(() => {
        for (const id of finalFallbacks.keys()) triggerFinalFallback(id);
    }, Math.min(FINAL_LIVE_WAIT_MS, timeoutMs / 2));
    let result;
    let storageTimer;
    try {
        result = await Promise.race([
            workflowLogSender.flush({ timeoutMs }),
            new Promise(resolve => {
                storageTimer = setTimeout(() => resolve({ acknowledged: false, ...workflowLogSender.getStats() }), timeoutMs);
            }),
        ]);
    } finally {
        clearTimeout(fallbackTimer);
        clearTimeout(storageTimer);
    }
    // Unacknowledged stored snapshots must reach the independent live channel
    // before Lambda freezes, including callers without a visitor cookie.
    for (const id of finalFallbacks.keys()) triggerFinalFallback(id);
    let timer;
    try {
        await Promise.race([
            workflowDebugSender.idle(),
            new Promise(resolve => { timer = setTimeout(resolve, Math.max(0, deadline - Date.now())); }),
        ]);
    } finally {
        clearTimeout(timer);
    }
    const newRejections = result.rejected - reportedRejections;
    const newAbandonments = result.abandoned - reportedAbandonments;
    if ((!result.acknowledged || newRejections || newAbandonments) && Date.now() >= nextWarningAt) {
        console.warn('Workflow log delivery incomplete', { ...result, newRejections, newAbandonments });
        reportedRejections = result.rejected;
        reportedAbandonments = result.abandoned;
        nextWarningAt = Date.now() + 30000;
    }
    return result;
}

function hasActionError(results) {
    if (!results || typeof results !== 'object') return false;
    for (const actionId in results) {
        if (results[actionId]?.error != null) return true;
    }
    return false;
}

function getWorkflowLogType(trigger) {
    switch (trigger) {
        case null:
            return 'reusable';
        case 'ww-middleware':
            return 'middleware';
        case 'ww-api':
            return 'api';
        default:
            return 'workflow';
    }
}

// Identity only: the session object carries tokens.
function getAuthIdentity(auth) {
    return { isAuthenticated: !!auth?.isAuthenticated, userId: auth?.user?.id };
}

function getConnectionIdentities(connections) {
    const identities = [];
    for (const key in connections || {}) {
        if (identities.length >= MAX_LOGGED_CONNECTIONS) break;
        const connection = connections[key];
        identities.push({ id: connection?.id, integration: connection?.integration });
    }
    return identities;
}

function buildHeaders(options = {}) {
    return {
        'Content-Type': 'application/json',
        'ww-project-id': process.env.WEWEB_PROJECT_ID,
        'ww-project-secret': process.env.WEWEB_PROJECT_SECRET,
        ...(options.socketId && { 'ww-socket-id': options.socketId }),
        ...(options.editorUserId && { 'ww-editor-user-id': options.editorUserId }),
    };
}

export default {
    sanitizeWorkflowDebugResults,
    /** @returns {Promise<import('./editorRuntime.service.ts').EditorRuntime>} */
    async getEditorRuntime(options = {}) {
        const response = await fetch(`${process.env.WEWEB_BACK_URL}/v2/lambda/back/runtime-config`, {
            headers: buildHeaders(options),
            signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) throw new Error('Failed to fetch editor runtime configuration');
        const runtime = await response.json();
        if (!isPlainObject(runtime) || !isPlainObject(runtime.connections) || !isPlainObject(runtime.envVariables)) {
            throw new Error('Invalid editor runtime configuration');
        }
        for (const env of ['editor', 'staging', 'production']) {
            if (!isPlainObject(runtime.envVariables[env])) throw new Error('Invalid editor runtime environment');
        }
        return runtime;
    },
    async getBackWorkflowsByTrigger(trigger, options = {}) {
        if (process.env.WEWEB_ENV === 'local' && process.env.NODE_ENV === 'production') return {};
        const response = await fetch(
            `${process.env.WEWEB_BACK_URL}/v2/lambda/back/workflows/triggers?trigger=${trigger}&includeTableFormulaColumns=true`,
            { headers: buildHeaders(options) }
        );
        if (!response.ok) {
            if (response.status === 403) {
                const data = await response.json();
                if (data.error === 'WORKFLOW_SECURITY_CHECK_FAILED') {
                    throw new SecurityCheckError(data);
                }
            }
            throw new Error('Failed to fetch back workflows by trigger');
        }
        return await response.json();
    },
    async ensureDesignAccess(designId, userCookie) {
        console.log('Ensuring design access for designId:', designId);
        if (process.env.WEWEB_ENV === 'local' && process.env.NODE_ENV === 'production') return {};
        const response = await fetch(`${process.env.WEWEB_BACK_URL}/v2/designs/${designId}/ensure`, {
            headers: {
                'Content-Type': 'application/json',
                Cookie: `ww-access-token=${userCookie}`,
            },
        });
        if (!response.ok) throw new Error('Failed to ensure design access');
        return true;
    },
    // Resolves once the payload is sent, failed or dropped, or after one request timeout while it waits in the queue,
    // so an awaiting workflow is never delayed by more than that. It never rejects.
    sendWorkflowDebug(id, debugResults, socketId = null, identity = {}) {
        if (process.env.ENV !== 'editor' || (process.env.WEWEB_ENV === 'local' && process.env.NODE_ENV === 'production')) {
            return Promise.resolve();
        }

        return new Promise(resolve => {
            const timer = setTimeout(resolve, LIVE_DEBUG_SENDER_LIMITS.timeoutMs);
            const done = () => {
                clearTimeout(timer);
                resolve();
            };
            try {
                const sanitizedResults = sanitizeWorkflowDebugResults(debugResults);
                const body = JSON.stringify({ debugResults: sanitizedResults, socketId, ...identity });
                workflowDebugSender.enqueue({
                    target: id,
                    body,
                    bytes: utf8ByteLength(body),
                    isError: hasActionError(sanitizedResults),
                    done,
                });
            } catch {
                done();
            }
        });
    },
    // Best-effort: captures a bounded snapshot synchronously and never throws into the workflow.
    finalizeWorkflowDebug(workflow, context, socketId = null) {
        try {
            if (process.env.ENV !== 'editor') return;
            // The ChatGPT editor embed token takes precedence over the session cookie.
            const accessToken =
                context.http?.headers?.get?.('ww-access-token') || context.http?.cookies?.['ww-access-token'];
            // Legacy callers without an editor user session retain live debugging.
            if (typeof accessToken !== 'string' || !accessToken || accessToken.length > MAX_ACCESS_TOKEN_LENGTH) {
                void this.sendWorkflowDebug(workflow.id, context.workflow, socketId, { traceId: context.traceId, executionId: context.debugExecutionId, final: true });
                return;
            }
            if (!workflow?.designId || !workflow?.id || !context.traceId) return;

            const encoded = encodeWorkflowFinalSnapshot({
                designId: workflow.designId,
                workflowId: workflow.id,
                traceId: context.traceId,
                executionId: context.debugExecutionId,
                type: getWorkflowLogType(workflow.trigger),
                origin: 'back',
                logs: context.workflow || {},
                context: {
                    auth: getAuthIdentity(context.auth),
                    parameters: context.parameters,
                    connections: getConnectionIdentities(context.connections),
                    callstack: context.callstack,
                },
                errors: [],
            }, socketId);
            const accepted = workflowLogSender.enqueue({
                id: encoded.id,
                target: encoded.designId,
                body: encoded.body,
                isError: encoded.hasError,
                credential: accessToken,
            });
            // A previous slow/failed storage ACK cannot delay this run's final UI.
            if (!accepted) enqueueLiveFinalSnapshot(JSON.parse(encoded.body));
            else scheduleFinalFallback(encoded);
        } catch {
            void this.sendWorkflowDebug(workflow?.id, { __metadata: { truncated: true, reasons: { capture: 1 } } }, socketId, { traceId: context?.traceId, executionId: context?.debugExecutionId, final: true });
        }
    },
    async matchWorkflowByPath(method, path, options = {}) {
        if (process.env.WEWEB_ENV === 'local' && process.env.NODE_ENV === 'production') return null;
        const response = await fetch(`${process.env.WEWEB_BACK_URL}/v2/lambda/back/workflows/match`, {
            method: 'POST',
            headers: buildHeaders(options),
            body: JSON.stringify({ method, path, includeTableFormulaColumns: true }),
        });
        if (!response.ok) {
            if (response.status === 404) return null;
            if (response.status === 403) {
                const data = await response.json();
                if (data.error === 'WORKFLOW_SECURITY_CHECK_FAILED') {
                    throw new SecurityCheckError(data);
                }
            }
            throw new Error('Failed to match workflow by path');
        }
        return await response.json();
    },
    async getTableViewById(id, options = {}) {
        if (process.env.WEWEB_ENV === 'local' && process.env.NODE_ENV === 'production') return null;
        const url = new URL(`${process.env.WEWEB_BACK_URL}/v2/lambda/back/table-views/${id}`);
        if (options.wwEditionMode) {
            url.searchParams.append('wwEditionMode', options.wwEditionMode);
        }
        const response = await fetch(url, {
            headers: buildHeaders(options),
        });
        if (!response.ok) {
            if (response.status === 404) return null;
            if (response.status === 403) {
                const data = await response.json();
                if (
                    data.error === 'WORKFLOW_SECURITY_CHECK_FAILED' ||
                    data.error === 'TABLE_VIEW_SECURITY_CHECK_FAILED'
                ) {
                    throw new SecurityCheckError(data);
                }
            }
            throw new Error('Failed to fetch table view by id');
        }
        return await response.json();
    },
    async getIntegrationTableById(id, options = {}) {
        if (process.env.WEWEB_ENV === 'local' && process.env.NODE_ENV === 'production') return null;
        const response = await fetch(`${process.env.WEWEB_BACK_URL}/v2/lambda/back/integration-tables/${id}`, {
            headers: buildHeaders(options),
        });
        if (!response.ok) {
            if (response.status === 404) return null;
            if (response.status === 403) {
                const data = await response.json();
                if (data.error === 'TABLE_VIEW_SECURITY_CHECK_FAILED') {
                    throw new SecurityCheckError(data);
                }
            }
            throw new Error('Failed to fetch integration table by id');
        }
        return await response.json();
    },
    async getDatabaseSchema(env, options = {}) {
        if (process.env.WEWEB_ENV === 'local' && process.env.NODE_ENV === 'production') return null;
        const url = new URL(`${process.env.WEWEB_BACK_URL}/v2/lambda/back/database/schema`);
        if (env) {
            url.searchParams.set('env', env);
        }
        const response = await fetch(url, {
            headers: buildHeaders(options),
        });
        if (!response.ok) throw new Error('Failed to fetch database schema');
        return await response.json();
    },
};
