import type { BetterFetchPlugin, BetterFetchOption } from '@better-fetch/fetch';
import { createFetch } from '@better-fetch/fetch';
import { getServerUrl } from './backendWorkflows.js';
/* wwFront:start */
import { redirectToAppAccessDenied, redirectToAppAccessSignIn } from './appAccessRedirects';
/* wwFront:end */
 
interface QueuedRequest {
    resolve: () => void;
}

function createSecurityAuditPlugin(): BetterFetchPlugin {
    return {
        id: 'security-audit-plugin',
        name: 'Security Audit Plugin',
        hooks: {
            onError(context) {
             },
        },
    };
}

const WW_CONCURRENCY = 4;

let activeRequests = 0;
const queue: QueuedRequest[] = [];

const processQueue = () => {
    while (queue.length > 0 && activeRequests < WW_CONCURRENCY) {
        const next = queue.shift();
        if (next) {
            activeRequests++;
            next.resolve();
        }
    }
};

const baseFetch = createFetch({
    baseURL: getServerUrl() + 'api',
    retry: {
        type: 'linear',
        attempts: 20,
        delay: 100,
        shouldRetry: response => {
            return response.status === 429;
        },
    },
    plugins: [createSecurityAuditPlugin()],
    throw: true,
    credentials: 'include',
     /* wwFront:start */
    onError(context) {
        const code = context.error?.code;
        if (context.response.status === 401 && code === 'APP_ACCESS_REQUIRED') redirectToAppAccessSignIn();
        if (context.response.status === 403 && code === 'APP_ACCESS_DENIED') redirectToAppAccessDenied();
    },
    /* wwFront:end */
});

async function wwServerClient<T>(url: string, options?: BetterFetchOption): Promise<T> {
    if (activeRequests >= WW_CONCURRENCY) {
        await new Promise<void>(resolve => queue.push({ resolve }));
    } else {
        activeRequests++;
    }

    try {
        return await baseFetch(url, options);
    } finally {
        activeRequests--;
        processQueue();
    }
}

export default wwServerClient;
