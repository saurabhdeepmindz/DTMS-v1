import { schedulerExpressions } from './cron.ts';
import type { CronDefinition, JobDriver, SchedulerDefinition } from './types.ts';
import { signLambdaUrlRequest } from '../services/awsLambdaUrlSigning.service.ts';

export interface SchedulerTarget {
    proxyUrl: string;
    region: string;
    environment: string;
    installationId: string;
}

export function createJobScheduler(target: SchedulerTarget, signal?: AbortSignal) {
    // Never sign credentials for an arbitrary host from project settings or Jobs storage.
    const url = new URL(target.proxyUrl);
    if (
        url.protocol !== 'https:' ||
        !/^[a-z0-9]+\.lambda-url\.[a-z0-9-]+\.on\.aws$/.test(url.hostname) ||
        url.hostname.split('.')[2] !== target.region ||
        url.username ||
        url.password ||
        url.port ||
        url.search ||
        url.hash ||
        url.pathname !== '/'
    ) {
        throw new Error('Invalid Jobs proxy URL');
    }

    async function request(operation: string, payload: Record<string, unknown> = {}) {
        const body = JSON.stringify({
            operation,
            environment: target.environment,
            installationId: target.installationId,
            ...payload,
        });
        const signed = await signLambdaUrlRequest({
            url: url.href,
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body,
        });
        signal?.throwIfAborted();
        const response = await fetch(signed.url, {
            method: 'POST',
            headers: signed.headers,
            body,
            signal: signal ?? AbortSignal.timeout(60000),
            redirect: 'error',
        });
        if (!response.ok) {
            throw new Error(`Jobs proxy request failed (${response.status})`);
        }

        return response.json() as Promise<{ ids?: string[] }>;
    }

    return {
        async wake() {
            await request('wake');
        },
        async wakeAt(date: string) {
            await request('wakeAt', { date });
        },
        async sync(
            driver: JobDriver,
            workerId: string,
            revision: string | null,
            onInvalid?: (definition: CronDefinition, error: unknown) => void
        ) {
            const schedules = (await driver.schedules())
                .filter(schedule => schedule.is_current)
                .map(schedule => schedule.definition);
            const definitions: Record<string, SchedulerDefinition> = {};
            for (const cron of schedules) {
                if (!cron.enabled) {
                    continue;
                }

                let expressions: string[];
                try {
                    expressions = schedulerExpressions(cron);
                } catch (error) {
                    // A definition AWS cannot express must not stop the other timers. The snapshot sent to
                    // planScheduler still has to match storage exactly, so only its timers are left out.
                    onInvalid?.(cron, error);
                    continue;
                }

                for (const [index, expression] of expressions.entries()) {
                    definitions[cron.id + ':' + index] = {
                        installationId: target.installationId,
                        expression,
                        timezone: cron.timezone || 'UTC',
                    };
                }
            }

            const operations = await driver.planScheduler(workerId, revision, schedules, definitions);
            if (!operations.length) {
                return false;
            }

            const result = await request('applyCrons', { operations });
            const ids = operations.map(operation => operation.id);
            if (
                !Array.isArray(result.ids) ||
                result.ids.length !== ids.length ||
                result.ids.some((id, index) => id !== ids[index])
            ) {
                throw new Error('Invalid Jobs proxy acknowledgement');
            }

            await driver.ackScheduler(workerId, revision, ids);

            // Bound each pass so the runner can check deployment, entitlement and its time budget.
            return operations.length === 25;
        },
    };
}
