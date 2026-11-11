import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { retryDate } from './validation.ts';
import { WORKER_LEASE_MARGIN_MS, WORKER_SHUTDOWN_MARGIN_MS } from './budget.ts';
import type { HostedJobBudget } from './budget.ts';
import type { Diagnostic, Job, JobDriver, Json } from './types.ts';

export interface ExecutionResult {
    result: Diagnostic;
    logs?: Diagnostic;
    revision: string;
}
export interface RunnerOptions {
    driver: JobDriver;
    revision?: string;
    execute: (job: Job, signal: AbortSignal) => Promise<ExecutionResult>;
    beforeExecute?: () => Promise<void>;
    materialize?: (workerId: string) => Promise<boolean | void>;
    wakeAt?: (date: string) => Promise<void>;
    continue?: () => Promise<void>;
    onFinalFailure?: (job: Job) => Promise<void>;
    onError?: (error: unknown) => void;
    concurrency?: number;
    deadline?: number;
    budget?: HostedJobBudget;
    shutdownMarginMs?: number;
    signal?: AbortSignal;
    pollMs?: number;
}

export class JobStoppedError extends Error {
    readonly outcome: 'cancelled' | 'interrupted' | 'failed';
    constructor(outcome: 'cancelled' | 'interrupted' | 'failed', message: string) {
        super(message);
        this.outcome = outcome;
        this.name = outcome === 'failed' ? 'JobTimeout' : 'JobStopped';
    }
}

function errorValue(error: unknown): Json {
    const value = error as { name?: unknown; message?: unknown };

    return {
        name: typeof value?.name === 'string' ? value.name : 'JobError',
        message: typeof value?.message === 'string' ? value.message.slice(0, 16384) : 'Scheduled Task execution failed',
    };
}

const CRON_RESOLUTION_MS = 60000;

function nextCronBoundary(now: number) {
    return (Math.floor(now / CRON_RESOLUTION_MS) + 1) * CRON_RESOLUTION_MS;
}

/** One drain. The caller selects Lambda invocation or a self-hosted long-running loop. */
export async function runJobsOnce(options: RunnerOptions): Promise<void> {
    const { driver } = options;
    const concurrency = options.concurrency ?? 5;
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 100) {
        throw new Error('Scheduled Task concurrency must be between 1 and 100');
    }

    const budget = options.budget;
    const workerId = randomUUID();
    const deadline = options.deadline ?? Infinity;
    if (deadline !== Infinity && !Number.isFinite(deadline)) {
        throw new Error('Invalid worker deadline');
    }

    if (deadline <= Date.now()) {
        return;
    }

    // SQL uses its own clock. Include a margin beyond Lambda's actual hard deadline.
    const leaseMs = Number.isFinite(deadline) ? Math.ceil(deadline - Date.now()) + WORKER_LEASE_MARGIN_MS : undefined;
    if (!(await driver.acquireWorker(workerId, options.revision, leaseMs))) {
        return;
    }

    const active = new Map<string, { controller: AbortController; completion: Promise<void> }>();
    const margin = options.shutdownMarginMs ?? WORKER_SHUTDOWN_MARGIN_MS;
    let stopping = false;
    let fatalError: unknown;
    let moreOccurrences = false;
    let nextMaterialization = Infinity;
    let prepared = false;
    let infrastructureFailed = false;

    async function prepare() {
        if (prepared) {
            return;
        }

        await options.beforeExecute?.();
        prepared = true;
    }

    function stop(reason: JobStoppedError) {
        stopping = true;
        for (const attempt of active.values()) {
            attempt.controller.abort(reason);
        }
    }

    const onAbort = () => stop(new JobStoppedError('interrupted', 'Worker shutdown requested'));
    options.signal?.addEventListener('abort', onAbort, { once: true });
    if (options.signal?.aborted) {
        onAbort();
    }

    async function execute(job: Job, controller: AbortController) {
        let completed: Job | null = null;
        const timeout = setTimeout(
            () => controller.abort(new JobStoppedError('failed', 'Scheduled Task attempt exceeded its time limit')),
            job.timeout_ms
        );
        try {
            let execution: ExecutionResult | undefined;
            let failure: unknown;
            try {
                execution = await options.execute(job, controller.signal);
            } catch (error) {
                failure = error;
            }

            // Cooperative cancellation must wait for the execution itself, never race it against a timeout.
            const reason = controller.signal.aborted ? controller.signal.reason : failure;
            const executionOutcome = failure ? 'failed' : 'succeeded';
            const outcome = reason instanceof JobStoppedError ? reason.outcome : executionOutcome;
            completed = await driver.finish({
                id: job.id,
                token: job.token!,
                outcome,
                revision: execution?.revision ?? (failure as { revision?: string })?.revision,
                result: execution?.result,
                logs: execution?.logs ?? (failure as { logs?: Diagnostic })?.logs,
                ...(reason && { error: errorValue(reason) }),
                // A final failure keeps its scheduled date: no retry will run at a later one.
                retryAt:
                    outcome === 'failed' && job.attempts >= job.max_attempts
                        ? job.run_at
                        : retryDate(job.attempts, job.retry_delay_ms),
            });
        } finally {
            clearTimeout(timeout);
        }

        if (completed?.status === 'failed') {
            // Existing event workflow behavior: no notification jobs or hook retries.
            await options.onFinalFailure?.(completed).catch(error => options.onError?.(error));
        }
    }

    try {
        if (Date.now() >= deadline - (budget?.stopClaimingMs ?? margin)) {
            moreOccurrences = true;

            return;
        }

        for (const recovered of await driver.recover(workerId)) {
            if (recovered.status === 'failed' && options.onFinalFailure) {
                await prepare();
                await options.onFinalFailure?.(recovered).catch(error => options.onError?.(error));
            }
        }

        async function materialize() {
            moreOccurrences = !!(await options.materialize?.(workerId));
            // Cron occurrences are due at minute boundaries. Running tasks must not delay unrelated schedules.
            nextMaterialization = options.materialize ? nextCronBoundary(Date.now()) : Infinity;
            if (budget) {
                // This is a configuration failure, not an execution attempt. Keep history and inputs for replay.
                await driver.rejectOversized(workerId, budget.maxAttemptMs, options.revision);
            }
        }

        // Configuration/materialization can fail before the first claim. Preserve the hosted
        // recovery timer for overdue work, including when AWS exhausts its delivery retries.
        const firstWake = await driver.nextWake();
        if (firstWake && Date.parse(firstWake) <= Date.now()) {
            await prepare();
        }
        await materialize();
        while (true) {
            if (Date.now() >= deadline - (budget?.stopClaimingMs ?? margin)) {
                stopping = true;
            }

            const state = await driver.runtime();
            if (!state.enabled || state.pendingRevision || state.revision !== (options.revision ?? null)) {
                stopping = true;
            }

            if (!stopping && (moreOccurrences || Date.now() >= nextMaterialization)) {
                await materialize();
            }

            if (Date.now() >= deadline - margin) {
                stop(new JobStoppedError('interrupted', 'Worker is reaching its execution deadline'));
            }

            if (active.size) {
                const states = await driver.statuses([...active.keys()]);
                for (const state of states) {
                    if (state.cancel_requested_at) {
                        active
                            .get(state.id)
                            ?.controller.abort(new JobStoppedError('cancelled', 'Scheduled Task cancelled'));
                    }
                }
            }

            while (!stopping && active.size < concurrency) {
                const budget = Math.max(0, deadline - Date.now() - margin);
                const job = await driver.claim(workerId, budget, options.revision);
                if (!job) {
                    break;
                }

                if (!prepared) {
                    try {
                        // Register recovery only for an invocation with actual work, before any user code.
                        await prepare();
                    } catch (error) {
                        await driver.finish({
                            id: job.id,
                            token: job.token!,
                            outcome: 'interrupted',
                            error: errorValue(error),
                        });
                        throw error;
                    }
                }

                // Setup may have consumed the time budget while this claim was reserved.
                if (stopping || options.signal?.aborted || job.timeout_ms > deadline - Date.now() - margin) {
                    await driver.finish({ id: job.id, token: job.token!, outcome: 'interrupted' });
                    stopping = true;
                    break;
                }

                const controller = new AbortController();
                const completion = execute(job, controller)
                    .catch(error => {
                        fatalError = error;
                        stop(new JobStoppedError('interrupted', 'Worker persistence failed'));
                    })
                    .finally(() => active.delete(job.id));
                active.set(job.id, { controller, completion });
            }

            if (!active.size) {
                if (moreOccurrences && !stopping) {
                    continue;
                }

                break;
            }

            await Promise.race([
                sleep(Math.max(0, Math.min(options.pollMs ?? 500, nextMaterialization - Date.now()))),
                ...Array.from(active.values(), attempt => attempt.completion),
            ]);
        }

        if (fatalError) {
            throw fatalError;
        }
    } catch (error) {
        infrastructureFailed = true;
        stop(new JobStoppedError('interrupted', 'Worker stopped after an infrastructure error'));
        await Promise.allSettled(Array.from(active.values(), attempt => attempt.completion));
        throw error;
    } finally {
        options.signal?.removeEventListener('abort', onAbort);
        // Release before invoking the replacement. Concurrent wakeups record a durable request
        // under the same database lock, including arrivals after the final empty claim.
        const requested = await driver.releaseWorker(workerId);
        const state = await driver.runtime();
        // Failed hosted deliveries already get AWS's delayed retries and the recovery timer above.
        // An immediate replacement bypasses those delays and can perpetuate a WAF block.
        if (!infrastructureFailed && state.enabled && !state.pendingRevision) {
            const next = await driver.nextWake();
            if (requested || moreOccurrences || (next && Date.parse(next) <= Date.now())) {
                await options.continue?.();
            } else if (next) {
                await options.wakeAt?.(next);
            }
        }
    }
}
