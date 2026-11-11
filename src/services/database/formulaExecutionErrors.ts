import { PublicHTTPException } from '../../core/http.errors.ts';
import type { FormulaSqlCall } from './queryBuilder.ts';

type FormulaExecutionAudience = 'editor' | 'published';
type FormulaExecutionCategory =
    'arithmetic' | 'database-busy' | 'invalid-data' | 'limit' | 'schema' | 'timeout' | 'unknown';

type FormulaExecutionDiagnostic = {
    formulaId: string;
    field: string;
    scopeAlias?: string;
    artifactHash?: string;
};

export class FormulaExecutionError extends Error {
    readonly code = 'FORMULA_EXECUTION_FAILED';
    readonly category: FormulaExecutionCategory;
    readonly formulas: FormulaExecutionDiagnostic[];

    constructor(error: unknown, calls: FormulaSqlCall[]) {
        super('Formula execution failed');
        this.name = 'FormulaExecutionError';
        this.category = categorizeFormulaExecutionError(error);
        this.formulas = deduplicateFormulaDiagnostics(calls);
    }
}

export class FormulaUnavailableError extends Error {
    readonly code: 'FORMULA_V2_PENDING' | 'FORMULA_V2_NEEDS_ATTENTION';
    readonly formulas: Array<{ field: string; errorCode?: string }>;

    constructor(formulas: Array<{ name: string; transferErrorCode?: string | null }>) {
        const needsAttention = formulas.some(formula => !!formula.transferErrorCode);
        super(needsAttention ? 'Formula V2 needs attention' : 'Formula V2 is pending');
        this.name = 'FormulaUnavailableError';
        this.code = needsAttention ? 'FORMULA_V2_NEEDS_ATTENTION' : 'FORMULA_V2_PENDING';
        this.formulas = formulas.map(formula => ({
            field: formula.name,
            ...(formula.transferErrorCode ? { errorCode: formula.transferErrorCode } : {}),
        }));
    }
}

export class FormulaQueryPlanningError extends Error {
    readonly code = 'FORMULA_MANY_RELATION_QUERY_UNSUPPORTED';
    readonly formulas: Array<{ field: string; scopeAlias: string }>;

    constructor(scopeAlias: string, formulaNames: string[]) {
        super('Formula V2 query shape is unsupported');
        this.name = 'FormulaQueryPlanningError';
        this.formulas = [...new Set(formulaNames)]
            .sort()
            .map(field => ({ field, scopeAlias }));
    }
}

function categorizeFormulaExecutionError(error: unknown): FormulaExecutionCategory {
    const databaseError = error as { code?: unknown; message?: unknown };
    const code = databaseError?.code;
    if (typeof code !== 'string') return 'unknown';
    if (code === 'P0001' && typeof databaseError.message === 'string') {
        if (databaseError.message.startsWith('FORMULA_V2_USER:')) return 'invalid-data';
        if (/^FORMULA_V2_RUNTIME:(?:.*BUDGET|.*LIMIT|.*SIZE|.*DEPTH)/.test(databaseError.message)) return 'limit';
        if (databaseError.message.startsWith('FORMULA_V2_RUNTIME:')) return 'invalid-data';
    }
    if (code === '22012') return 'arithmetic';
    if (code === '55P03') return 'database-busy';
    if (code === '57014') return 'timeout';
    if (['42703', '42704', '42883', '42P01'].includes(code)) return 'schema';
    if (code.startsWith('22')) return 'invalid-data';
    return 'unknown';
}

function deduplicateFormulaDiagnostics(calls: FormulaSqlCall[]): FormulaExecutionDiagnostic[] {
    const diagnostics = new Map<string, FormulaExecutionDiagnostic>();
    for (const call of calls) {
        const diagnostic = {
            formulaId: call.formulaId,
            field: call.field,
            ...(call.scopeAlias ? { scopeAlias: call.scopeAlias } : {}),
            ...(call.artifactHash ? { artifactHash: call.artifactHash } : {}),
        };
        diagnostics.set(`${call.scopeAlias || ''}\u0000${call.formulaId}`, diagnostic);
    }
    return [...diagnostics.values()];
}

function getOriginatingFormulaCalls(error: unknown, calls: FormulaSqlCall[]) {
    const databaseError = error as { message?: unknown; where?: unknown; internalQuery?: unknown };
    const context = [databaseError.message, databaseError.where, databaseError.internalQuery]
        .filter((value): value is string => typeof value === 'string')
        .join('\n');
    return calls.filter(call => context.includes(call.sqlName));
}

export async function withFormulaExecutionBoundary<T>(calls: FormulaSqlCall[], callback: () => Promise<T>): Promise<T> {
    if (!calls.length) return callback();
    try {
        return await callback();
    } catch (error) {
        const originatingCalls = getOriginatingFormulaCalls(error, calls);
        if (!originatingCalls.length) throw error;
        throw new FormulaExecutionError(error, originatingCalls);
    }
}

export function throwFormulaExecutionHttpError(
    error: FormulaExecutionError,
    context: { get(name: '_requestId'): string | undefined },
    audience: FormulaExecutionAudience
): never {
    const requestId = context.get('_requestId') || 'unknown';
    console.error(
        `WW-FORMULA-ERROR:${JSON.stringify({
            requestId,
            code: error.code,
            category: error.category,
            formulas: error.formulas.map(formula => ({
                formulaId: formula.formulaId,
                ...(formula.artifactHash ? { artifactHash: formula.artifactHash } : {}),
            })),
        })}`
    );

    const formulaNames = [...new Set(error.formulas.map(formula => formula.field))];
    const editorPrefix =
        error.category === 'timeout'
            ? 'Calculating this table’s formulas took too long.'
            : error.category === 'limit'
              ? `Formula ${formulaNames.map(name => `"${name}"`).join(', ') || 'calculation'} exceeded its execution limit.`
              : formulaNames.length
                ? `Formula ${formulaNames.map(name => `"${name}"`).join(', ')} failed (${error.category}).`
                : `Formula execution failed (${error.category}).`;
    const message =
        audience === 'editor'
            ? `${editorPrefix} Request ID: ${requestId}`
            : `Formula query failed. Request ID: ${requestId}`;
    throw new PublicHTTPException(500, message, { code: error.code, requestId });
}

export function throwFormulaUnavailableHttpError(
    error: FormulaUnavailableError,
    audience: FormulaExecutionAudience
): never {
    const formulaNames = [...new Set(error.formulas.map(formula => formula.field))];
    const quotedNames = formulaNames.map(name => `"${name}"`).join(', ');
    const editorMessage =
        error.code === 'FORMULA_V2_PENDING'
            ? `Formula ${quotedNames} is waiting for its backend schema.`
            : `Formula ${quotedNames} needs attention before it can be queried.`;
    throw new PublicHTTPException(409, audience === 'editor' ? editorMessage : 'Formula query is unavailable.', {
        code: error.code,
        ...(audience === 'editor' ? { formulas: error.formulas } : {}),
    });
}

export function throwFormulaQueryPlanningHttpError(
    error: FormulaQueryPlanningError,
    audience: FormulaExecutionAudience
): never {
    const formulaNames = error.formulas.map(formula => `"${formula.scopeAlias}.${formula.field}"`).join(', ');
    const editorMessage = `Formula ${formulaNames} cannot be filtered or sorted across a many-record relation.`;
    throw new PublicHTTPException(400, audience === 'editor' ? editorMessage : 'Formula query is unsupported.', {
        code: error.code,
        ...(audience === 'editor' ? { formulas: error.formulas } : {}),
    });
}
