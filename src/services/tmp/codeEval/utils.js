import { getCachedCode, getCachedCodeAsync } from './cache.js';
import { CodeEvalError } from './errors.js';
import { staticWwFormulas, createDynamicWwFormulas } from '../formulas/wwFormulas.js';
import { getEnv } from '../../env.service.ts';
import { getWorkflowSignal, getWorkflowConsole } from '../../workflowContext.service.ts';

const envVariablesProxy = new Proxy(
    {},
    {
        get: (_target, prop) => {
            if (typeof prop === 'string') {
                const envVariable = getEnv(prop);
                return envVariable || undefined;
            }
            return undefined;
        },
    }
);

function createCodeContext(context) {
    const requestParams = getParametersInContext(context);

    return {
        parameters: {
            ...requestParams,
            ...(context.parameters || {}),
        },
        http: context.http,
        job: context.job,
        signal: getWorkflowSignal(),
        env: envVariablesProxy,
        workflow: context.workflow,
        auth: context.auth,
        runtimeEnv: context.env,
        event: context.event,
        row: context.row,
        mapping: context.mapping,
    };
}

function createWwFormulas(context, additionalUtils) {
    return {
        ...staticWwFormulas,
        ...createDynamicWwFormulas(context),
        ...(additionalUtils || {}),
    };
}

function getParametersInContext(context) {
    const isGetOrDelete = context?.http && ['GET', 'DELETE'].includes(context?.http.method.toUpperCase());
    return (isGetOrDelete ? context.http?.query : context.http?.body) || {};
}

// Synchronous evaluation for formulas
function evaluateCode({ code, context, wwFormulas, integrations }) {
    try {
        const fn = getCachedCode(code);

        return fn(context, wwFormulas, integrations, getWorkflowConsole());
    } catch (error) {
        if (error instanceof CodeEvalError) {
            throw error;
        }
        throw new CodeEvalError(`Code evaluation error: ${error.message}`, {
            originalError: error,
            code,
        });
    }
}

// Async evaluation for custom-js actions (supports await import)
async function evaluateCodeAsync({ code, context, wwFormulas, integrations }) {
    try {
        const fn = getCachedCodeAsync(code);

        return await fn(context, wwFormulas, integrations, getWorkflowConsole());
    } catch (error) {
        if (error instanceof CodeEvalError) {
            throw error;
        }
        throw new CodeEvalError(`Code evaluation error: ${error.message}`, {
            originalError: error,
            code,
        });
    }
}

export { createCodeContext, createWwFormulas, evaluateCode, evaluateCodeAsync, getParametersInContext };
