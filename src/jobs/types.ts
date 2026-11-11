export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JobStatus = 'pending' | 'running' | 'retry_wait' | 'succeeded' | 'failed' | 'cancelled';
export type JobOutcome = 'succeeded' | 'failed' | 'cancelled' | 'interrupted';
export interface JobInput {
    workflowId: string;
    inputs?: Record<string, Json>;
    name?: string;
    runAt?: string;
    priority?: number;
    key?: string;
    keyMode?: 'replace' | 'preserve_run_at';
    queue?: string;
    maxAttempts?: number;
    timeoutMs?: number;
    retryDelayMs?: number;
    replayOf?: string;
}
export interface Diagnostic {
    value?: Json;
    preview?: string;
    truncated: boolean;
    unavailable?: boolean;
}
export interface Job {
    id: string;
    workflow_id: string;
    inputs: Record<string, Json>;
    name: string;
    status: JobStatus;
    run_at: string;
    priority: number;
    job_key: string | null;
    queue_name: string | null;
    schedule_id: string | null;
    occurrence_at: string | null;
    replay_of: string | null;
    attempts: number;
    attempt_sequence: number;
    max_attempts: number;
    timeout_ms: number;
    retry_delay_ms: number;
    token: string | null;
    cancel_requested_at: string | null;
    result: Diagnostic | null;
    error: Json | null;
    created_at: string;
    completed_at: string | null;
    history?: Attempt[];
}
export interface Attempt {
    sequence: number;
    revision: string | null;
    started_at: string;
    finished_at: string | null;
    outcome: JobOutcome | null;
    error: Json | null;
    logs: Diagnostic | null;
}
export interface CronDefinition extends JobInput {
    startsAt?: string;
    requiredParameters?: string[];
    id: string;
    cron: string;
    timezone?: string;
    enabled: boolean;
    overlap?: 'allow' | 'queue' | 'skip';
    backfillHours?: number;
}
export interface StoredSchedule {
    id: string;
    definition: CronDefinition;
    cursor_at: string;
    active_since: string;
    is_current: boolean;
    ends_at?: string;
    enabled: boolean;
}
export interface JobFilter {
    status?: JobStatus;
    workflowId?: string;
    queue?: string;
    search?: string;
    from?: string;
    to?: string;
    before?: string;
    beforeId?: string;
    limit?: number;
}
export interface JobFinish {
    id: string;
    token: string;
    outcome: JobOutcome;
    revision?: string;
    result?: Diagnostic;
    error?: Json;
    logs?: Diagnostic;
    retryAt?: string;
}
export interface SchedulerDefinition {
    installationId: string;
    expression: string;
    timezone: string;
}
export type SchedulerOperation = { id: string; scheduleId: string; installationId: string } & (
    { action: 'put'; expression: string; timezone: string } | { action: 'delete' }
);
export interface RuntimeState {
    workerExpiresAt?: string | null;
    enabled: boolean;
    paused?: boolean;
    accepting?: boolean;
    revision: string | null;
    pendingRevision: string | null;
    error: string | null;
}
export interface JobState {
    id: string;
    status: JobStatus | null;
    cancel_requested_at: string | null;
    attempt_sequence: number | null;
}
export interface JobDriver {
    runtime(): Promise<RuntimeState>;
    reconciliation(revision: string | null, error?: string): Promise<void>;
    planScheduler(
        workerId: string,
        revision: string | null,
        schedules: CronDefinition[],
        definitions: Record<string, SchedulerDefinition>
    ): Promise<SchedulerOperation[]>;
    ackScheduler(workerId: string, revision: string | null, ids: string[]): Promise<void>;
    enqueue(jobs: JobInput[]): Promise<Job[]>;
    acquireWorker(workerId: string, revision?: string, leaseMs?: number): Promise<boolean>;
    releaseWorker(workerId: string): Promise<boolean>;
    rejectOversized(workerId: string, maxAttemptMs: number, revision?: string): Promise<void>;
    claim(workerId: string, budgetMs: number, revision?: string): Promise<Job | null>;
    recover(workerId: string): Promise<Job[]>;
    finish(attempt: JobFinish): Promise<Job | null>;
    cancel(id: string): Promise<Job | null>;
    reschedule(id: string, runAt: string): Promise<Job>;
    get(id: string): Promise<Job | null>;
    statuses(ids: string[]): Promise<JobState[]>;
    list(filter?: JobFilter): Promise<Job[]>;
    cleanup(before: string, status?: JobStatus, limit?: number): Promise<number>;
    nextWake(): Promise<string | null>;
    schedules(): Promise<StoredSchedule[]>;
    syncSchedules(schedules: CronDefinition[]): Promise<void>;
    materialize(
        scheduleId: string,
        cursor: string,
        through: string,
        occurrences: { at: string }[],
        revision?: string
    ): Promise<boolean>;
}
