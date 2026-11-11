import type { Console } from 'node:console';
import { setImmediate } from 'node:timers/promises';
import { getContextValue, runWithContext } from './tmp/utils/context.js';

interface WorkflowContext {
    signal: AbortSignal;
    deadline?: number;
    console: Console;
}

export function runWithWorkflowContext<T>(fn: () => Promise<T>, context: WorkflowContext): Promise<T> {
    return runWithContext(fn, { workflowExecution: context });
}

function getWorkflowContext(): WorkflowContext | undefined {
    return getContextValue('workflowExecution');
}

export function getWorkflowSignal(): AbortSignal | undefined {
    return getWorkflowContext()?.signal;
}

export function getWorkflowConsole(): Console {
    return getWorkflowContext()?.console ?? console;
}

/** Yield to cancellation timers/I/O even when every preceding action resolved synchronously. */
export async function workflowCheckpoint() {
    const context = getWorkflowContext();
    if (!context) {
        return;
    }

    const check = () => {
        context.signal.throwIfAborted();
        if (context.deadline !== undefined && Date.now() >= context.deadline) {
            throw Object.assign(new Error('Scheduled Task attempt exceeded its time limit'), { name: 'JobTimeout' });
        }
    };

    check();
    await setImmediate();
    check();
}
