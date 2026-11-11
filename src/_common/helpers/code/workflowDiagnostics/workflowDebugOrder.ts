// The final upload and live updates use independent transports. Reject late
// deltas after a final snapshot, and old root runs after a new test is started.
const MAX_TRACKED_RUNS = 256;
const activeTraces = new Map<string, string>();
const completedExecutions = new Set<string>();
const supersededTraces = new Set<string>();

export function beginWorkflowDebugRun(workflowId: string, traceId: string) {
    const previous = activeTraces.get(workflowId);
    if (previous && previous !== traceId) {
        supersededTraces.add(`${workflowId}:${previous}`);
        if (supersededTraces.size > MAX_TRACKED_RUNS) supersededTraces.delete(supersededTraces.values().next().value!);
    }
    activeTraces.delete(workflowId);
    activeTraces.set(workflowId, traceId);
    if (activeTraces.size > MAX_TRACKED_RUNS) activeTraces.delete(activeTraces.keys().next().value!);
}

export function acceptWorkflowDebugUpdate({ workflowId, traceId, executionId, final }: { workflowId: string; traceId?: string; executionId?: string; final?: boolean }): boolean {
    // Older published/editor runtimes omit this metadata; keep their debugger compatible.
    if (typeof traceId === 'string' && traceId.length <= 255) {
        if (supersededTraces.has(`${workflowId}:${traceId}`)) return false;
    }
    if (!executionId || typeof executionId !== 'string' || executionId.length > 36) return true;
    const key = `${workflowId}:${executionId}`;
    if (completedExecutions.has(key)) return false;
    if (final) {
        completedExecutions.add(key);
        if (completedExecutions.size > MAX_TRACKED_RUNS) completedExecutions.delete(completedExecutions.values().next().value!);
    }
    return true;
}
