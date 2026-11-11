import { setTimeout as sleep } from 'node:timers/promises';
import jobsSettings from '../data/jobs.json' with { type: 'json' };
import { packagedExecutionData } from '../services/workflowExecution.service.ts';
import type { WorkflowExecutionData } from '../services/workflowExecution.service.ts';
import { createHash } from 'node:crypto';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';
import { originalEnv } from '../core/env.core.js';
import { postgresJobDriver, supabaseJobDriver } from './driver.ts';
import { jobsSchemaVersion } from './schema-version.ts';
import { jobsSqlCall } from './sql-call.ts';
import { readHostedJobBudget, WORKER_RECOVERY_MARGIN_MS, WORKER_SHUTDOWN_MARGIN_MS } from './budget.ts';
import { jobsInvocation } from './invocation.ts';
import { JobStoppedError, runJobsOnce } from './runner.ts';
import { executeAttempt } from './attempt.ts';
import { usesLiveEditorRuntime } from './editor-runtime.ts';
import { materializeCrons, validateCron } from './cron.ts';
import { createJobScheduler } from './scheduler.ts';
import { normalizeJobParameters, parameterError, validateJob } from './validation.ts';
import type { CronDefinition, Job, JobDriver, JobInput } from './types.ts';

interface Snapshot extends WorkflowExecutionData {
    active: boolean;
    revision: string;
    concurrency: number;
    driver: {
        integration: 'weweb-table' | 'supabase';
        installationId: string;
        schema?: string;
        databaseUrl?: string;
        url?: string;
        secretKey?: string;
        connectionId?: string;
    };
    schemaSql?: string;
}
const pools = new Map<string, pg.Pool>();
const report = (error: unknown) =>
    console.error('Scheduled Tasks:', error instanceof Error ? error.message : 'Operation failed');
const currentEnv = () => process.env.ENV || originalEnv.ENV || 'editor';

function hostedBudget() {
    if (!originalEnv.AWS_LAMBDA_FUNCTION_NAME) {
        return undefined;
    }

    return readHostedJobBudget(originalEnv.WEWEB_JOBS_BUDGET);
}

async function loadJobsEnvironment(workflowId?: string, live = true): Promise<Snapshot> {
    if (originalEnv.AWS_LAMBDA_FUNCTION_NAME && originalEnv.WEWEB_JOBS_ENABLED !== 'true') {
        return { active: false } as Snapshot;
    }

    if (live && usesLiveEditorRuntime()) {
        if (!process.env.WEWEB_BACK_URL || !process.env.WEWEB_PROJECT_SECRET) {
            throw new Error('Live Editor Scheduled Tasks runtime configuration is incomplete');
        }
        const response = await fetch(
            `${process.env.WEWEB_BACK_URL}/v2/lambda/back/jobs/editor-runtime${workflowId ? `?workflowId=${encodeURIComponent(workflowId)}` : ''}`,
            {
                headers: {
                    'ww-project-id': process.env.WEWEB_PROJECT_ID!,
                    'ww-project-secret': process.env.WEWEB_PROJECT_SECRET!,
                },
                signal: AbortSignal.timeout(15000),
            }
        );
        if (!response.ok) {
            if (response.status === 425) {
                throw new JobStoppedError('interrupted', 'Scheduled Tasks runtime is updating');
            }
            throw new Error(`Unable to load Scheduled Tasks environment (${response.status})`);
        }

        return response.json() as Promise<Snapshot>;
    }

    const settings: any = jobsSettings;
    const runtime = originalEnv.WEWEB_JOBS_CONFIG ?? process.env.WEWEB_JOBS_CONFIG;
    const configuration = runtime !== undefined ? JSON.parse(runtime) : settings?.[currentEnv()];
    if (!configuration) {
        return { active: false } as Snapshot;
    }

    const packaged = settings?.[currentEnv()];
    if (!originalEnv.AWS_LAMBDA_FUNCTION_NAME && packaged?.schemaSql && packaged.schemaVersion !== jobsSchemaVersion) {
        throw new Error(
            'Scheduled Tasks schema and server versions differ; export a compatible server before upgrading'
        );
    }

    const { workflows, connections } = packagedExecutionData;
    const driver = { ...configuration.driver };
    if (driver.integration === 'weweb-table') {
        driver.databaseUrl ||= process.env.DATABASE_URL;
    } else if (!driver.url || !driver.secretKey) {
        const connection = connections[driver.connectionId]?.config || {};
        const value = (key: string) =>
            connection[key]?.__envVariableKey ? process.env[connection[key].__envVariableKey] : connection[key];
        driver.url = value('customDomain') || `https://${value('branchRef') || value('projectRef')}.supabase.co`;
        driver.secretKey = value('secretKey');
    }

    return {
        active: true,
        revision: createHash('sha256').update(JSON.stringify(workflows)).digest('hex'),
        ...packagedExecutionData,
        concurrency: configuration.concurrency || 5,
        schemaSql:
            configuration.schemaSql ||
            (packaged?.driver?.installationId === driver.installationId ? packaged.schemaSql : undefined),
        driver,
    };
}

const initialized = new Set<string>();

async function initializeSelfHosted(snapshot: Snapshot) {
    if (
        originalEnv.AWS_LAMBDA_FUNCTION_NAME ||
        !snapshot.schemaSql ||
        initialized.has(snapshot.driver.installationId)
    ) {
        return;
    }

    const databaseUrl = snapshot.driver.databaseUrl || process.env.JOBS_DATABASE_URL;
    if (!databaseUrl) {
        return;
    } // Supabase without direct SQL access uses the exported installation script.

    const client = new pg.Client({
        connectionString: databaseUrl,
        connectionTimeoutMillis: 10000,
        query_timeout: 30000,
    });
    await client.connect();
    try {
        const name = jobsSqlCall('prepareSchemaUpgrade', {}, snapshot.driver.schema).name;
        const exists = await client.query('SELECT to_regprocedure($1) IS NOT NULL AS installed', [
            `public.${name}(integer,integer)`,
        ]);
        // Commit the barrier separately, so the old process can see it and finish its active attempts.
        // If still busy, the migration refuses to run and the startup loop retries; it never takes over its lease.
        if (exists.rows[0].installed) {
            await client.query(`SELECT public.${name}(p_version => $1)`, [jobsSchemaVersion]);
        }

        await client.query('BEGIN');
        await client.query("SET LOCAL lock_timeout = '5s'");
        await client.query(snapshot.schemaSql);
        await client.query('COMMIT');
        initialized.add(snapshot.driver.installationId);
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        await client.end();
    }
}

function driverFor(snapshot: Snapshot): JobDriver {
    const configuration = snapshot.driver;
    if (configuration.integration === 'supabase') {
        return supabaseJobDriver(createClient(configuration.url!, configuration.secretKey!), configuration.schema);
    }

    let pool = pools.get(configuration.installationId);
    if (!pool) {
        pool = new pg.Pool({
            connectionString: configuration.databaseUrl,
            max: 5,
            connectionTimeoutMillis: 10000,
            query_timeout: 15000,
            idleTimeoutMillis: 10000,
            application_name: `weweb-jobs:${configuration.installationId}`,
        });
        // PostgreSQL may disconnect idle clients during restarts or failover.
        // Without a listener pg emits an unhandled error and stops the self-hosted server.
        pool.on('error', report);
        pools.set(configuration.installationId, pool);
    }

    return postgresJobDriver(pool, configuration.schema);
}

function schedulerFor(snapshot: Snapshot, signal?: AbortSignal) {
    if (!originalEnv.AWS_LAMBDA_FUNCTION_NAME) {
        return null;
    }

    return createJobScheduler(
        {
            proxyUrl: originalEnv.JOBS_LAMBDA_URL || process.env.JOBS_LAMBDA_URL!,
            environment: currentEnv(),
            installationId: snapshot.driver.installationId,
            region: originalEnv.AWS_REGION!,
        },
        signal
    );
}

export async function wakeJobsAfterResponse(context: { getRemainingTimeInMillis(): number }) {
    if (!jobsInvocation.getStore()?.queued) {
        return;
    }

    const budget = hostedBudget();
    if (!budget) {
        return;
    }

    const remaining = context.getRemainingTimeInMillis();
    if (remaining <= 1000) {
        return;
    }

    if (remaining > budget.stopClaimingMs) {
        await executeJobs({ deadline: Date.now() + remaining });

        return;
    }

    const snapshot = await loadJobsEnvironment(undefined, false);
    if (!snapshot.active) {
        return;
    }

    // No lease was acquired: a fresh invocation has the project's full time budget.
    await schedulerFor(snapshot, AbortSignal.timeout(Math.min(2000, remaining - 1000)))?.wake();
}

function cronDefinitions(snapshot: Snapshot): CronDefinition[] {
    const definitions: CronDefinition[] = [];
    for (const workflow of snapshot.workflows) {
        if (workflow.trigger !== 'ww-job') {
            continue;
        }

        for (const trigger of workflow.meta?.jobs?.crons || []) {
            const { uiFrequency: _presentation, ...configuration } = trigger;
            definitions.push({
                ...configuration,
                workflowId: workflow.id,
                name: workflow.name,
                enabled: !!trigger.enabled,
                requiredParameters: (workflow.parameters || [])
                    .filter((parameter: any) => parameter.required)
                    .map((parameter: any) =>
                        parameter.type === 'table-link' ? `table:${parameter.name}` : parameter.name
                    ),
            });
        }
    }

    return definitions;
}

export async function scheduleJobs(inputs: JobInput[]): Promise<Job[]> {
    const budget = hostedBudget();
    const snapshot = await loadJobsEnvironment();
    if (!snapshot.active) {
        throw new Error('Scheduled Tasks are not configured or the environment is hibernated');
    }

    await initializeSelfHosted(snapshot);
    const driver = driverFor(snapshot);
    const state = await driver.runtime();
    if (!(state.accepting ?? state.enabled)) {
        throw new Error('Scheduled Tasks are not accepting tasks');
    }

    const maxAttemptMs = budget?.maxAttemptMs;
    const validatedInputs = inputs.map(input => {
        const validated = validateJob(input, { hosted: !!originalEnv.AWS_LAMBDA_FUNCTION_NAME });
        if (maxAttemptMs !== undefined) {
            if (validated.timeoutMs !== undefined && validated.timeoutMs > maxAttemptMs) {
                throw new Error(
                    'Attempt timeout exceeds the configured server timeout; reduce it or update server settings.'
                );
            }

            validated.timeoutMs ??= Math.min(300000, maxAttemptMs);
        }

        return validated;
    });
    for (const input of validatedInputs) {
        const workflow = snapshot.workflows.find(
            workflow => workflow.id === input.workflowId && workflow.trigger === 'ww-job'
        );
        if (!workflow) {
            throw new Error('Select a Scheduled Task workflow in this environment');
        }

        for (const parameter of workflow.parameters || []) {
            const error = parameterError(parameter, input.inputs);
            if (error) {
                throw new Error(error);
            }
        }
        input.inputs = normalizeJobParameters(input.inputs || {}, workflow.parameters || []) as JobInput['inputs'];
    }

    const jobs = await driver.enqueue(validatedInputs);
    if (state.paused) return jobs;
    // Enqueue committed successfully. Signal failures must not retry the parent workflow and duplicate its jobs.
    try {
        const scheduler = schedulerFor(snapshot);
        if (scheduler) {
            let immediate = false;
            const dates = new Set(jobs.map(job => job.run_at));
            for (const date of dates) {
                if (Date.parse(date) <= Date.now()) {
                    immediate = true;
                } else {
                    await scheduler.wakeAt(date).catch(report);
                }
            }

            if (immediate) {
                const invocation = jobsInvocation.getStore();
                if (invocation) {
                    invocation.queued = true;
                }

                // Deliver a durable wake even if the HTTP invocation fails before sending its response.
                await scheduler.wake().catch(report);
            }
        }
    } catch (error) {
        report(error);
    }

    return jobs;
}

/** Cancels a scheduled task that has not completed yet. A running attempt stops at its next cooperative check. */
export async function cancelJob(id: string) {
    if (typeof id !== 'string' || !id) {
        throw new Error('Select the ID of the scheduled task to unschedule');
    }

    const snapshot = await loadJobsEnvironment();
    if (!snapshot.active) {
        throw new Error('Scheduled Tasks are not configured');
    }

    return driverFor(snapshot).cancel(id);
}

export async function cleanupJobs(before: string, status = 'succeeded') {
    const snapshot = await loadJobsEnvironment();
    if (!snapshot.active) {
        throw new Error('Scheduled Tasks are not configured');
    }

    if (!['succeeded', 'failed', 'cancelled'].includes(status)) {
        throw new Error('Only completed Scheduled Task history can be cleaned');
    }

    return driverFor(snapshot).cleanup(before, status as 'succeeded' | 'failed' | 'cancelled', 1000);
}

export async function executeJobs(options: { deadline?: number; signal?: AbortSignal; installationId?: string } = {}) {
    const snapshot = await loadJobsEnvironment(undefined, !originalEnv.AWS_LAMBDA_FUNCTION_NAME);
    if (!snapshot.active || (options.installationId && options.installationId !== snapshot.driver.installationId)) {
        return;
    }

    const budget = hostedBudget();
    if (budget && !Number.isFinite(options.deadline)) {
        throw new Error('Hosted Scheduled Tasks require the Lambda invocation deadline');
    }

    await initializeSelfHosted(snapshot);
    const driver = driverFor(snapshot);
    const scheduler = schedulerFor(snapshot);
    const revision = originalEnv.AWS_LAMBDA_FUNCTION_VERSION;
    const liveEditor = usesLiveEditorRuntime();
    const execute = async (job: Job, signal: AbortSignal) => {
        const latest = liveEditor ? await loadJobsEnvironment(job.workflow_id) : snapshot;
        if (!latest.active || latest.driver.installationId !== snapshot.driver.installationId) {
            throw new Error('Scheduled Tasks environment changed during acquisition');
        }

        return executeAttempt({ job, snapshot: latest }, signal);
    };

    const materialize = async (workerId: string) => {
        // Only the lease holder fetches live Editor definitions. Duplicate wakes exit before this call.
        if (liveEditor) {
            await loadJobsEnvironment();
        }

        const current = await driver.runtime();
        if (!current.enabled || current.pendingRevision || current.revision !== (revision ?? null)) {
            return false;
        }

        // Hosted schedules are activated by deployment (or by editor saves). Only standalone servers sync their package.
        if (!originalEnv.AWS_LAMBDA_FUNCTION_NAME && !liveEditor) {
            await driver.syncSchedules(
                cronDefinitions(snapshot).map(definition => {
                    if (!definition.enabled) {
                        return definition;
                    }

                    try {
                        return validateCron(definition);
                    } catch (error) {
                        report(error);

                        return { ...definition, enabled: false };
                    }
                })
            );
        }

        try {
            const failures: string[] = [];
            const note = (id: string, error: unknown) => {
                if (!failures.includes(id)) {
                    failures.push(id);
                }

                report(error);
            };
            const remaining = await materializeCrons(driver, new Date(), revision, (schedule, error) =>
                note(schedule.definition.id, error)
            );
            const pendingSchedulerOperations = scheduler
                ? await scheduler.sync(driver, workerId, revision ?? null, (definition, error) =>
                      note(definition.id, error)
                  )
                : false;
            // An unusable definition is reported on the installation; every other schedule keeps running.
            if (failures.length) {
                await driver
                    .reconciliation(
                        revision ?? null,
                        `Some Scheduled Tasks schedules are invalid and will not run: ${failures.join(', ')}`
                    )
                    .catch(report);
            } else if (current.error) {
                // An earlier failed pass must not leave a warning after synchronization recovers.
                await driver.reconciliation(revision ?? null);
            }

            return remaining || pendingSchedulerOperations;
        } catch (error) {
            await driver.reconciliation(revision ?? null, 'Scheduled Tasks synchronization failed.').catch(report);
            throw error;
        }
    };

    const onFinalFailure = async (job: Job) => {
        const latest = liveEditor ? await loadJobsEnvironment('__jobs_failure_hooks__') : snapshot;
        if (!latest.active) {
            return;
        }

        const budget = Math.max(
            1,
            Math.min(300000, (options.deadline ?? Infinity) - Date.now() - WORKER_SHUTDOWN_MARGIN_MS)
        );
        await executeAttempt(
            { job, snapshot: latest, failureHook: true },
            options.signal
                ? AbortSignal.any([options.signal, AbortSignal.timeout(budget)])
                : AbortSignal.timeout(budget)
        );
    };

    const config = {
        driver,
        revision,
        execute,
        // Async delivery retries may arrive before our lease expires. Register a later recovery wake,
        // once before draining overdue work; empty/duplicate invocations must not create a periodic timer.
        beforeExecute:
            scheduler && options.deadline
                ? async () => {
                      // Use SQL's committed expiry: connection/lock delays may extend it beyond our local estimate.
                      const { workerExpiresAt } = await driver.runtime();
                      if (!workerExpiresAt) {
                          throw new Error('Hosted Scheduled Tasks require a finite worker lease');
                      }

                      await scheduler.wakeAt(
                          new Date(Date.parse(workerExpiresAt) + WORKER_RECOVERY_MARGIN_MS).toISOString()
                      );
                  }
                : undefined,
        materialize,
        onFinalFailure,
        onError: report,
        concurrency: snapshot.concurrency,
        budget,
        deadline: options.deadline,
        signal: options.signal,
        wakeAt: scheduler?.wakeAt,
        continue: scheduler?.wake,
    };
    await runJobsOnce(config);
}

export async function startJobsLoop(signal: AbortSignal) {
    let retryDelayMs = 1000;
    while (!signal.aborted) {
        let delayMs = 1000;
        try {
            await executeJobs({ signal });
            retryDelayMs = 1000;
        } catch (error) {
            report(error);
            delayMs = retryDelayMs;
            retryDelayMs = Math.min(60000, retryDelayMs * 2);
        }

        await sleep(delayMs, undefined, { signal }).catch(() => {});
    }
}
