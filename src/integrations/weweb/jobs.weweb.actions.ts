import { scheduleJobs, cancelJob, cleanupJobs } from '../../jobs/runtime.ts';

global.registerAction('schedule-job', async (action: any) => {
    const {
        workflowId,
        parameters = {},
        runAt,
        jobName,
        queue,
        key,
        keyMode,
        priority,
        maxAttempts,
        timeoutMs,
    } = action;
    const [job] = await scheduleJobs([
        {
            workflowId,
            inputs: parameters,
            runAt: runAt || undefined,
            // `action.name` is the action label shown in the workflow, never the task name.
            name: jobName || undefined,
            queue,
            key,
            keyMode,
            priority,
            maxAttempts,
            timeoutMs,
        },
    ]);

    return { id: job.id, status: job.status, runAt: job.run_at };
});

global.registerAction('schedule-jobs', async (action: any) => {
    if (!Array.isArray(action.items)) {
        throw new Error('Select a list of Scheduled Task inputs');
    }

    const jobs = await scheduleJobs(
        action.items.map((inputs: any) => ({
            workflowId: action.workflowId,
            inputs,
            runAt: action.runAt || undefined,
            queue: action.queue,
            priority: action.priority,
            maxAttempts: action.maxAttempts,
            timeoutMs: action.timeoutMs,
        }))
    );

    return jobs.map(job => ({ id: job.id, status: job.status, runAt: job.run_at }));
});

global.registerAction('cancel-job', async (action: any) => {
    const job = await cancelJob(action.jobId);

    return { id: action.jobId, cancelled: !!job, status: job?.status ?? null };
});

global.registerAction('cleanup-jobs', async (action: any) => ({
    deleted: await cleanupJobs(action.before, action.status),
}));
