import { validateDate, validateJob } from './validation.ts';
import { jobsSchemaVersion } from './schema-version.ts';
import { jobsSqlCall } from './sql-call.ts';
import { setTimeout as sleep } from 'node:timers/promises';
import type {
    CronDefinition,
    Job,
    JobDriver,
    JobFilter,
    JobFinish,
    JobInput,
    JobStatus,
    JobState,
    StoredSchedule,
    RuntimeState,
    SchedulerOperation,
} from './types.ts';

type Rpc = <T>(operation: string, payload?: object) => Promise<T>;

/** Both providers call the same transactional SQL contract. */
export function createJobDriver(transport: Rpc, schemaVersion = jobsSchemaVersion): JobDriver {
    const rpc: Rpc = (operation, payload = {}) => transport(operation, { ...payload, schemaVersion });

    return {
        runtime: () => rpc<RuntimeState>('runtime'),
        reconciliation: async (revision, error) => {
            await rpc('reconciliation', { revision, error });
        },
        planScheduler: (workerId, revision, schedules, definitions) =>
            rpc<SchedulerOperation[]>('planScheduler', { workerId, revision, schedules, definitions }),
        ackScheduler: async (workerId, revision, ids) => {
            await rpc('ackScheduler', { workerId, revision, ids });
        },
        enqueue(jobs: JobInput[]) {
            if (!Array.isArray(jobs) || jobs.length === 0 || jobs.length > 100) {
                throw new Error('Schedule between 1 and 100 scheduled tasks per batch');
            }

            return rpc<Job[]>('enqueue', { jobs: jobs.map(job => validateJob(job)) });
        },
        acquireWorker: (workerId, revision, leaseMs) => rpc<boolean>('acquireWorker', { workerId, revision, leaseMs }),
        releaseWorker: workerId => rpc<boolean>('releaseWorker', { workerId }),
        rejectOversized: async (workerId, maxAttemptMs, revision) => {
            await rpc('rejectOversized', { workerId, maxAttemptMs, revision });
        },
        claim: (workerId, budgetMs, revision) =>
            rpc<Job | null>('claim', {
                workerId,
                revision,
                budgetMs: Math.floor(Math.min(budgetMs, 2147483647)),
            }),
        recover: workerId => rpc<Job[]>('recover', { workerId }),
        finish: (attempt: JobFinish) => rpc<Job | null>('finish', attempt),
        cancel: id => rpc<Job | null>('cancel', { id }),
        reschedule: (id, runAt) => rpc<Job>('reschedule', { id, runAt: validateDate(runAt) }),
        get: id => rpc<Job | null>('get', { id }),
        statuses: ids => rpc<JobState[]>('statuses', { ids }),
        list: (filter: JobFilter = {}) => rpc<Job[]>('list', filter),
        cleanup: (before: string, status: JobStatus = 'succeeded', limit = 100) =>
            rpc<number>('cleanup', { before: validateDate(before), status, limit }),
        nextWake: () => rpc<string | null>('nextWake'),
        schedules: () => rpc<StoredSchedule[]>('schedules'),
        syncSchedules: async (schedules: CronDefinition[]) => {
            await rpc('syncSchedules', { schedules });
        },
        materialize: (scheduleId, cursor, through, occurrences, revision) =>
            rpc<boolean>('materialize', { scheduleId, cursor, through, occurrences, revision }),
    };
}

export function postgresJobDriver(
    client: {
        query: (sql: string, values: unknown[]) => Promise<{ rows: any[] }>;
    },
    schema = 'jobs'
): JobDriver {
    return createJobDriver(async <T>(operation: string, payload = {}) => {
        const call = jobsSqlCall(operation, payload, schema);
        const { rows } = await client.query(call.sql, call.values);

        return rows[0].result as T;
    });
}

export function supabaseJobDriver(
    client: {
        rpc: (
            name: string,
            args: object
        ) => PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;
    },
    schema = 'jobs'
): JobDriver {
    return createJobDriver(async <T>(operation: string, payload = {}) => {
        const call = jobsSqlCall(operation, payload, schema);
        const deadline = Date.now() + 5000;
        for (;;) {
            const { data, error } = await client.rpc(call.name, call.args);
            if (!error) return data as T;
            // A missing schema-cache entry has not executed the operation.
            if (error.code !== 'PGRST202' || Date.now() >= deadline) throw new Error(error.message);
            await sleep(200);
        }
    });
}
