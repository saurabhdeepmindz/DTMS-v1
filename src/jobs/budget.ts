// Finish persistence and shutdown before Lambda's hard deadline.
export const WORKER_SHUTDOWN_MARGIN_MS = 10000;
// Keep ownership beyond the hard deadline so a replacement cannot overlap the old invocation.
export const WORKER_LEASE_MARGIN_MS = 10000;
// Schedule recovery after the committed lease expiry, with room for delivery/clock differences.
export const WORKER_RECOVERY_MARGIN_MS = 10000;

export interface HostedJobBudget {
    maxAttemptMs: number;
    stopClaimingMs: number;
}

/** The backend owns the policy; read the budget packaged into trusted Lambda configuration. */
export function readHostedJobBudget(value: string | undefined): HostedJobBudget {
    const budget = JSON.parse(value || 'null');
    if (
        !budget ||
        !Number.isInteger(budget.maxAttemptMs) ||
        budget.maxAttemptMs <= 0 ||
        !Number.isInteger(budget.stopClaimingMs) ||
        budget.stopClaimingMs <= 0
    ) {
        throw new Error('Scheduled Tasks require a valid server time budget. Update your server settings.');
    }

    return { maxAttemptMs: budget.maxAttemptMs, stopClaimingMs: budget.stopClaimingMs };
}
