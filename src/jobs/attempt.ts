import wewebService from '../services/weweb.service.js';
import { runWithEditorRuntime } from '../services/editorRuntime.service.ts';
import workflowCore from '../core/workflow.core.js';
import triggerCore from '../core/trigger.core.js';
import { prepareWorkflowExecution } from '../services/workflowExecution.service.ts';
import type { WorkflowExecutionData } from '../services/workflowExecution.service.ts';
import { runWithWorkflowContext } from '../services/workflowContext.service.ts';
import { captureAttemptLogs } from './logs.ts';
import { diagnostic } from './validation.ts';
import type { Job } from './types.ts';
import type { ExecutionResult } from './runner.ts';
import { usesLiveEditorRuntime } from './editor-runtime.ts';

type Snapshot = WorkflowExecutionData & { revision: string };
type Attempt = {
    job: Pick<Job, 'id' | 'workflow_id' | 'inputs'> & Partial<Job>;
    snapshot: Snapshot;
    failureHook?: boolean;
};

export function executeAttempt(data: Attempt & { failureHook: true }, signal: AbortSignal): Promise<null>;
export function executeAttempt(data: Attempt & { failureHook?: false }, signal: AbortSignal): Promise<ExecutionResult>;
export async function executeAttempt(data: Attempt, signal: AbortSignal) {
    signal.throwIfAborted();
    if (usesLiveEditorRuntime()) {
        if (!process.env.WEWEB_BACK_URL) throw new Error('Live Editor runtime requires WEWEB_BACK_URL');
        const runtime = await wewebService.getEditorRuntime();
        signal.throwIfAborted();
        const snapshot = { ...data.snapshot, connections: runtime.connections };
        return runWithEditorRuntime(runtime, () => executeAttemptWithRuntime({ ...data, snapshot }, signal));
    }
    return executeAttemptWithRuntime(data, signal);
}

async function executeAttemptWithRuntime({ job, snapshot, failureHook }: Attempt, signal: AbortSignal) {
    signal.throwIfAborted();
    // Runtime is also imported during action registration; initialize the shared registry once, at execution.
    await import('../integrations/index.ts');
    const context: any = {
        parameters: job.inputs,
        job: {
            id: job.id,
            attempt: job.attempt_sequence,
            scheduledAt: job.run_at,
            queue: job.queue_name,
            key: job.job_key,
        },
        ...prepareWorkflowExecution(snapshot),
        auth: { user: null, session: null, isAuthenticated: false },
        awaitCompletion: true,
        callstack: [],
        traceId: job.id,
    };
    const logs = captureAttemptLogs();
    try {
        return await runWithWorkflowContext(
            async () => {
                if (failureHook) {
                    await triggerCore.execute(
                        'ww-job-failed',
                        { jobId: job.id, workflowId: job.workflow_id, parameters: job.inputs, error: job.error },
                        { snapshot, awaitCompletion: true }
                    );

                    return null;
                }

                const workflow = snapshot.workflows.find(
                    workflow => workflow.id === job.workflow_id && workflow.trigger === 'ww-job'
                );
                if (!workflow) {
                    throw new Error('Scheduled Task workflow no longer exists in this environment');
                }

                for (const parameter of workflow.parameters || []) {
                    const key = parameter.type === 'table-link' ? `table:${parameter.name}` : parameter.name;
                    if (parameter.required && job.inputs[key] == null) {
                        throw new Error(`Missing required Scheduled Task parameter: ${parameter.name}`);
                    }
                }

                const result = await workflowCore.execute(workflow, context);
                signal.throwIfAborted();

                return { result: diagnostic(result), logs: logs.read(context.workflow), revision: snapshot.revision };
            },
            {
                signal,
                deadline: !failureHook && job.timeout_ms ? Date.now() + job.timeout_ms : undefined,
                console: logs.console,
            }
        );
    } catch (error) {
        throw Object.assign(new Error(error?.message || 'Scheduled Task workflow failed'), {
            name: error?.name || 'JobError',
            revision: snapshot.revision,
            logs: logs.read(context.workflow),
        });
    } finally {
        logs.close();
    }
}
