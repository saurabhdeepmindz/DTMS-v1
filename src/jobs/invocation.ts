import { AsyncLocalStorage } from 'node:async_hooks';

/** Scope post-response work to the HTTP request which actually submitted it. */
export const jobsInvocation = new AsyncLocalStorage<{ queued: boolean }>();
