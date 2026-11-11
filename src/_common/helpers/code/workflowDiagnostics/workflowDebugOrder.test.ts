import { expect, it } from 'vitest';
import { acceptWorkflowDebugUpdate, beginWorkflowDebugRun } from './workflowDebugOrder';

it('ignores live updates arriving after the final snapshot of the same execution', () => {
    const run = { workflowId: 'first', traceId: 'trace', executionId: 'execution' };
    expect(acceptWorkflowDebugUpdate(run)).toBe(true);
    expect(acceptWorkflowDebugUpdate({ ...run, final: true })).toBe(true);
    expect(acceptWorkflowDebugUpdate(run)).toBe(false);
});
it('ignores final snapshots from a previous editor test while the new one is running', () => {
    beginWorkflowDebugRun('second', 'old-trace');
    beginWorkflowDebugRun('second', 'new-trace');
    expect(acceptWorkflowDebugUpdate({ workflowId: 'second', traceId: 'old-trace', executionId: 'old', final: true })).toBe(false);
    expect(acceptWorkflowDebugUpdate({ workflowId: 'second', traceId: 'new-trace', executionId: 'new' })).toBe(true);
});
it('accepts nested and job traces without superseding a still-running canvas test', () => {
    beginWorkflowDebugRun('nested-job', 'direct');
    expect(acceptWorkflowDebugUpdate({ workflowId: 'nested-job', traceId: 'parent-trace', executionId: 'nested' })).toBe(true);
    expect(acceptWorkflowDebugUpdate({ workflowId: 'nested-job', traceId: 'direct', executionId: 'old', final: true })).toBe(true);
    expect(acceptWorkflowDebugUpdate({ workflowId: 'nested-job', traceId: 'job-trace', executionId: 'job' })).toBe(true);
});
it('accepts another nested invocation with the same trace but a different execution ID', () => {
    expect(acceptWorkflowDebugUpdate({ workflowId: 'nested', traceId: 'shared', executionId: 'one', final: true })).toBe(true);
    expect(acceptWorkflowDebugUpdate({ workflowId: 'nested', traceId: 'shared', executionId: 'two' })).toBe(true);
});
it('keeps legacy messages compatible and bounds the history', () => {
    expect(acceptWorkflowDebugUpdate({ workflowId: 'legacy' })).toBe(true);
    for (let i = 0; i < 257; i++) {
        beginWorkflowDebugRun(`bounded-${i}`, `trace-${i}`);
        acceptWorkflowDebugUpdate({ workflowId: `bounded-${i}`, executionId: `exec-${i}`, final: true });
    }
    expect(acceptWorkflowDebugUpdate({ workflowId: 'bounded-0', traceId: 'different', executionId: 'exec-0' })).toBe(true);
    expect(acceptWorkflowDebugUpdate({ workflowId: 'bounded-256', executionId: 'exec-256' })).toBe(false);
});
