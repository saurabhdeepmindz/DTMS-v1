import type { FormulaSqlCall } from './queryBuilder.ts';

export type FormulaNotice = { message?: string; detail?: string };
export type FormulaCellError = { formulaId: string; field: string; rowId: string | number | null; category: 'invalid-data'; message?: string };

const RUNTIME_MESSAGES: Record<string, string> = {
    EXECUTION_BUDGET_EXCEEDED: 'This formula exceeded its execution limit. Check for an endless loop or reduce the amount of work it performs.',
    DATA_BUDGET_EXCEEDED: 'This formula processes too much data. Reduce the size of its input or result.',
    INVALID_JSON: 'The value passed to JSON.parse is not valid JSON.',
    NULL_PROPERTY_ACCESS: 'Cannot read a property of null or undefined.',
    EXPECTED_ARRAY: 'This operation requires an array.',
    INVALID_DATE: 'The value is not a valid date.',
};

function formatCellErrorMessage(message: unknown): string | undefined {
    if (typeof message !== 'string' || !message.trim()) return undefined;
    const boundedMessage = message.slice(0, 2000);
    if (boundedMessage.startsWith('FORMULA_V2_RUNTIME:')) {
        const reason = boundedMessage.slice('FORMULA_V2_RUNTIME:'.length);
        if (Object.hasOwn(RUNTIME_MESSAGES, reason)) return RUNTIME_MESSAGES[reason];
        return reason.replaceAll('_', ' ').toLowerCase().replace(/^./, character => character.toUpperCase());
    }
    if (boundedMessage.startsWith('FORMULA_V2_USER:')) {
        const reason = boundedMessage.slice('FORMULA_V2_USER:'.length);
        try {
            const value = JSON.parse(reason);
            if (typeof value === 'string') return value || 'The formula threw an empty message.';
            if (value && typeof value.message === 'string' && value.message) return value.message;
        } catch {
            // A long thrown value may have been truncated by the preview function.
        }
        return `The formula threw: ${reason}`.slice(0, 2000);
    }
    return boundedMessage;
}

// Preview evaluation is limited to returned rows. Keep every cell diagnostic in
// that result, including pages with more than 100 failing cells.
export function collectFormulaWarnings(calls: FormulaSqlCall[], maxErrors = Infinity) {
    const errors: FormulaCellError[] = [];
    const seen = new Set<string>();
    let truncated = false;
    const onNotice = (notice: FormulaNotice) => {
        if (notice.message !== 'WW_FORMULA_CELL_ERROR' || !notice.detail) return;
        let detail: Record<string, unknown>;
        try {
            detail = JSON.parse(notice.detail);
        } catch {
            return;
        }
        if (!detail || detail.category !== 'invalid-data') return;
        const call = calls.find(call => !call.scopeAlias && call.sqlName === detail.sqlName);
        if (!call) return;
        const rowId = typeof detail.rowId === 'string' || typeof detail.rowId === 'number' ? detail.rowId : null;
        if (rowId === null && detail.rowId !== null) return;
        const key = JSON.stringify([call.formulaId, rowId]);
        if (seen.has(key)) return;
        if (errors.length >= maxErrors) {
            truncated = true;
            return;
        }
        seen.add(key);
        const message = formatCellErrorMessage(detail.message);
        errors.push({ formulaId: call.formulaId, field: call.field, rowId, category: 'invalid-data', ...(message ? { message } : {}) });
    };
    return { onNotice, errors, get truncated() { return truncated; } };
}
