import { HTTPException } from 'hono/http-exception';
import workflowCore from '../../core/workflow.core.js';
import { getValue } from '../../services/tmp/utils/input.js';

type SecurityConfig = {
    accessRule?: string;
    accessRoles?: string[];
    accessRolesCondition?: string;
    accessMiddlewares?: Array<{ workflowId?: string; parameters?: unknown }>;
};

type AuthContext = {
    user?: { roles?: string[] };
    isAuthenticated?: boolean;
};

type AccessOptions = {
    skip?: boolean;
    detailedErrors?: boolean;
};

type MiddlewareExecutionContext = Record<string, unknown> & {
    workflowResponse?: WorkflowResponse | null;
};

type WorkflowResponse = {
    metadata: Record<string, unknown>;
    httpResponse?: Response;
};

type AccessMiddlewareTermination = {
    actionResult: unknown;
    httpResponse?: Response;
};

type ParameterDefinition = {
    key?: string;
    name?: string;
    value?: unknown;
    type: 'text' | 'number' | 'boolean' | 'number|string' | 'object';
};

function throwUnauthenticated(detailedErrors: boolean) {
    if (detailedErrors) {
        throw new HTTPException(401, { message: 'Unauthenticated access', cause: 'User is not authenticated' });
    }
    throw new HTTPException(401);
}

function throwUnauthorized(detailedErrors: boolean) {
    if (detailedErrors) {
        throw new HTTPException(403, { message: 'Unauthorized access', cause: 'Invalid roles' });
    }
    throw new HTTPException(403);
}

export function assertAccessRules(
    security: SecurityConfig | undefined,
    auth: AuthContext | undefined,
    options: AccessOptions = {}
) {
    if (security?.accessRule !== 'authenticated') return;
    if (!auth?.isAuthenticated) {
        throwUnauthenticated(!!options.detailedErrors);
    }

    if (!security?.accessRoles?.length) return;
    const condition = security.accessRolesCondition === 'AND' ? 'every' : 'some';
    const hasAccess = security.accessRoles[condition](role => auth?.user?.roles?.includes(role));
    if (hasAccess) return;
    throwUnauthorized(!!options.detailedErrors);
}

export async function executeAccessMiddlewares(
    security: SecurityConfig | undefined,
    workflows: Array<{ id?: string }> | undefined,
    context: Record<string, unknown>,
    socketId: string | null = null
) {
    const middlewares = security?.accessMiddlewares || [];
    for (const middleware of middlewares) {
        const workflow = workflows?.find(currentWorkflow => currentWorkflow.id === middleware.workflowId);
        if (!workflow) throw new HTTPException(403);

        const middlewareContext: MiddlewareExecutionContext = {
            ...context,
            parameters: getValue(middleware.parameters, context),
            workflowResponse: null,
        };

        if (socketId) {
            middlewareContext.socketId = socketId;
        }

        const result = await workflowCore.execute(workflow, middlewareContext);
        if (middlewareContext.workflowResponse) {
            // The parent context owns late-response serialization after middleware execution completes.
            context.workflowResponse = middlewareContext.workflowResponse;
            return {
                actionResult: result,
                ...(middlewareContext.workflowResponse.httpResponse
                    ? { httpResponse: middlewareContext.workflowResponse.httpResponse }
                    : {}),
            } satisfies AccessMiddlewareTermination;
        }

        if (result instanceof Response) return { actionResult: result, httpResponse: result };
    }

    return null;
}

export function getAccessMiddlewareResult(termination: AccessMiddlewareTermination) {
    return termination.httpResponse ?? termination.actionResult;
}

const DEFAULT_TABLE_VIEW_PARAMETERS: ParameterDefinition[] = [
    { name: 'offset', type: 'number|string' },
    { name: 'limit', type: 'number' },
];

function parseObjectParameter(definition: ParameterDefinition, value: string) {
    const label = definition.name || definition.key || 'object';
    try {
        const parsed = JSON.parse(value);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Expected an object');
        return parsed;
    } catch {
        throw new HTTPException(400, { message: `Invalid object parameter "${label}".` });
    }
}

export function parseTableViewQuery(definitions: ParameterDefinition[] = [], values: Record<string, string> = {}) {
    const result: Record<string, unknown> = {};
    for (const definition of [definitions, DEFAULT_TABLE_VIEW_PARAMETERS].flat()) {
        const parameterKey = definition?.key || definition?.name;
        if (!parameterKey) continue;

        if (Object.hasOwn(values, parameterKey)) {
            switch (definition.type) {
                case 'number|string':
                    if (values[parameterKey].match(/^\d+$/)) {
                        result[parameterKey] = parseFloat(values[parameterKey]);
                    } else {
                        result[parameterKey] = values[parameterKey];
                    }
                    break;
                case 'number':
                    result[parameterKey] = parseFloat(values[parameterKey]);
                    break;
                case 'boolean':
                    result[parameterKey] =
                        values[parameterKey] === 'true' ||
                        values[parameterKey] === 'TRUE' ||
                        values[parameterKey] === '1';
                    break;
                case 'object':
                    result[parameterKey] = parseObjectParameter(definition, values[parameterKey]);
                    break;
                default:
                    result[parameterKey] = values[parameterKey];
            }
        } else {
            result[parameterKey] = definition.value;
        }
    }
    return result;
}
