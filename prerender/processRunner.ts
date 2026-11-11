import { spawn } from 'node:child_process';
import { classifyProcessExit } from './core.ts';
import type { ChildProcess } from 'node:child_process';
import type { ProcessResult, ProcessTerminationCategory } from './core.ts';

type ProcessSupervisor = {
    release(child: ChildProcess): void;
    track(child: ChildProcess): void;
    terminate(child: ChildProcess): void;
};

type ProcessRunnerOptions = {
    cwd: string;
    deadline: number | null;
    defaultEnvironment: NodeJS.ProcessEnv;
    supervisor: ProcessSupervisor;
};

type RunProcessOptions = {
    environment?: NodeJS.ProcessEnv;
    maxOutputBytes?: number;
    output?: 'capture' | 'ignore' | 'inherit';
    timeoutMs?: number;
};

const DEFAULT_MAX_CAPTURED_OUTPUT_BYTES = 64 * 1024;
const MAX_CAPTURED_OUTPUT_BYTES = 1024 * 1024;

export function createProcessRunner({ cwd, deadline, defaultEnvironment, supervisor }: ProcessRunnerOptions) {
    const isDeadlineReached = (): boolean => deadline !== null && Date.now() >= deadline;

    return function runProcess(
        command: string,
        args: string[],
        { environment, maxOutputBytes = DEFAULT_MAX_CAPTURED_OUTPUT_BYTES, output = 'inherit', timeoutMs }: RunProcessOptions = {}
    ): Promise<ProcessResult> {
        return new Promise(resolve => {
            if (isDeadlineReached()) {
                resolve({ ok: false, category: 'deadline', message: 'Execution deadline reached.' });
                return;
            }

            const child = spawn(command, args, {
                cwd,
                detached: process.platform !== 'win32',
                env: environment || defaultEnvironment,
                stdio: ['ignore', output === 'capture' ? 'pipe' : output, output === 'capture' ? 'pipe' : output],
            });
            supervisor.track(child);
            const capturedOutput = output === 'capture' ? createBoundedOutput(maxOutputBytes) : null;
            child.stdout?.on('data', chunk => capturedOutput?.append(chunk));
            child.stderr?.on('data', chunk => capturedOutput?.append(chunk));

            const deadlineTimeoutMs = deadline === null ? null : Math.max(deadline - Date.now(), 0);
            const effectiveTimeoutMs = getEffectiveTimeoutMs(timeoutMs, deadlineTimeoutMs);
            const timeoutCategory = getTimeoutCategory(timeoutMs, deadlineTimeoutMs);
            const timeoutExpiresAt = effectiveTimeoutMs === null ? null : Date.now() + effectiveTimeoutMs;
            let terminationCategory: ProcessTerminationCategory | undefined;
            let settled = false;
            const timeout =
                effectiveTimeoutMs === null
                    ? null
                    : setTimeout(() => {
                          terminationCategory = timeoutCategory;
                          supervisor.terminate(child);
                      }, effectiveTimeoutMs);

            const finish = (result: ProcessResult): void => {
                if (settled) return;
                settled = true;
                if (timeout) clearTimeout(timeout);
                supervisor.release(child);
                resolve(result);
            };

            child.on('close', code => {
                const exitTerminationCategory =
                    terminationCategory ||
                    (timeoutExpiresAt !== null && Date.now() >= timeoutExpiresAt ? timeoutCategory : undefined);
                const result = classifyProcessExit(code, exitTerminationCategory);
                const processMessage =
                    exitTerminationCategory === 'process-timeout'
                        ? `Process exceeded its ${timeoutMs}ms timeout.`
                        : `Process exited with code ${code}.`;
                finish({
                    ...result,
                    message: result.ok ? processMessage : appendCapturedOutput(processMessage, capturedOutput),
                });
            });
            child.on('error', error => {
                finish({
                    ok: false,
                    category: 'process-error',
                    message: error.message,
                });
            });
        });
    };
}

type BoundedOutput = {
    append(chunk: Uint8Array | string): void;
    read(): { text: string; truncated: boolean };
};

function createBoundedOutput(maxBytes: number): BoundedOutput {
    const requestedLimit = Number.isSafeInteger(maxBytes) && maxBytes > 0 ? maxBytes : DEFAULT_MAX_CAPTURED_OUTPUT_BYTES;
    const limit = Math.min(requestedLimit, MAX_CAPTURED_OUTPUT_BYTES);
    const chunks: Buffer[] = [];
    let capturedBytes = 0;
    let truncated = false;

    return {
        append(chunk) {
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            const remainingBytes = limit - capturedBytes;
            if (remainingBytes <= 0) {
                truncated = true;
                return;
            }

            const capturedChunk = buffer.subarray(0, remainingBytes);
            chunks.push(capturedChunk);
            capturedBytes += capturedChunk.length;
            if (capturedChunk.length < buffer.length) truncated = true;
        },
        read() {
            return {
                text: Buffer.concat(chunks, capturedBytes).toString('utf8'),
                truncated,
            };
        },
    };
}

function appendCapturedOutput(message: string, output: BoundedOutput | null): string {
    if (!output) return message;

    const captured = output.read();
    if (!captured.text) return message;
    return `${message}\nCaptured process output${captured.truncated ? ' (truncated)' : ''}:\n${captured.text}`;
}

function getEffectiveTimeoutMs(timeoutMs: number | undefined, deadlineTimeoutMs: number | null): number | null {
    if (timeoutMs === undefined) return deadlineTimeoutMs;
    if (deadlineTimeoutMs === null) return timeoutMs;
    return Math.min(timeoutMs, deadlineTimeoutMs);
}

function getTimeoutCategory(
    timeoutMs: number | undefined,
    deadlineTimeoutMs: number | null
): ProcessTerminationCategory {
    if (deadlineTimeoutMs !== null && (timeoutMs === undefined || deadlineTimeoutMs <= timeoutMs)) return 'deadline';
    return 'process-timeout';
}
