import { encodeWorkflowLogEnvelope, type WorkflowLogInput } from './workflowLogEnvelope.ts';
import { utf8ByteLength } from './boundedCapture.ts';
import { sanitizeWorkflowDebugResults } from '../workflowDebugTruncation.js';

// One larger final snapshot serves the live debugger. Back captures a smaller
// persisted envelope from it. Each request contains exactly one snapshot.
export const FINAL_SNAPSHOT_LIMITS = Object.freeze({
    maxEntryBytes: 1024 * 1024 - 1024,
    maxBatchBytes: 1024 * 1024,
    maxBatchRecords: 1,
});

export function encodeWorkflowFinalSnapshot(input: WorkflowLogInput & { executionId?: string }, socketId: string | null = null) {
    const logs = sanitizeWorkflowDebugResults(input.logs) as Record<string, unknown>;
    // Reuse the context budget without capturing/serializing the large logs twice.
    let metadata;
    try { metadata = encodeWorkflowLogEnvelope(input, { includeLogs: false }); } catch {
        metadata = encodeWorkflowLogEnvelope({ ...input, logs }, { includeLogs: false });
    }
    const snapshot = JSON.parse(metadata.body);
    const diagnostics = snapshot.context.diagnostics;
    snapshot.context.contextCapture = {
        truncated: diagnostics.truncated,
        truncationCount: diagnostics.truncationCount,
        reasons: diagnostics.reasons,
    };
    snapshot.context.diagnostics = {};
    const missingErrors = Object.create(null);
    for (const error of snapshot.context.errors) {
        if (typeof error.actionId === 'string' && !Object.hasOwn(logs, error.actionId)) missingErrors[error.actionId] = { error };
    }
    snapshot.logs = { ...logs, ...missingErrors };
    snapshot.socketId = socketId;
    snapshot.executionId = input.executionId;
    const body = JSON.stringify(snapshot);
    if (utf8ByteLength(body) > FINAL_SNAPSHOT_LIMITS.maxEntryBytes) throw new Error('WORKFLOW_FINAL_SNAPSHOT_TOO_LARGE');
    return { id: snapshot.id, designId: snapshot.designId, body, hasError: snapshot.hasError };
}
