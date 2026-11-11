import { tryGetContext } from 'hono/context-storage';

const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;
const RESPONSE_RESERVE_MS = 1_000;

type LambdaBudget = { getRemainingTimeInMillis(): number };
export type QueryRequestEnv = {
    Bindings: { lambdaContext?: LambdaBudget; context?: LambdaBudget };
    Variables: { _startTime?: number };
};

/** Recompute after acquiring the connection, so queueing and earlier work count. */
export function getQueryTimeoutMs(): number {
    const context = tryGetContext<QueryRequestEnv>();
    // Hono's buffered and streaming Lambda adapters expose different keys.
    const lambda = context?.env?.lambdaContext ?? context?.env?.context;
    const remaining = lambda?.getRemainingTimeInMillis?.()
        ?? DEFAULT_REQUEST_TIMEOUT_MS - (Date.now() - (context?.get('_startTime') ?? Date.now()));
    const timeout = Math.floor(remaining - RESPONSE_RESERVE_MS);
    if (timeout <= 0) {
        throw Object.assign(new Error('The request query budget has expired.'), { code: '57014' });
    }
    return timeout;
}
