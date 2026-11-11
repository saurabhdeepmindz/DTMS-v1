import { isFormulaBindingValue } from '../../schemas/formulas.ts';
import { isPlainObject } from '../../utils/objectGuards.ts';

function extractSelectionValue(value: unknown) {
    if (isPlainObject(value) && Object.hasOwn(value, '$value')) return value.$value;
    return value;
}

function cloneSelectionValue<T>(value: T): T {
    if (Array.isArray(value)) return value.map(entry => cloneSelectionValue(entry)) as T;
    if (!isPlainObject(value)) return value;

    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) result[key] = cloneSelectionValue(entry);
    return result as T;
}

function getDirectFormulaColumns(formulaColumns: Record<string, unknown>) {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(formulaColumns)) {
        if (key.startsWith('$')) continue;
        if (isFormulaBindingValue(value)) result[key] = cloneSelectionValue(value);
    }
    return result;
}

function isFormulaSelected(value: unknown) {
    const actualValue = extractSelectionValue(value);
    return actualValue === true || actualValue === '*' || isFormulaBindingValue(actualValue);
}

export function selectFormulaColumns(columns: unknown, formulaColumns: unknown, defaultAll = true): unknown {
    if (!isPlainObject(formulaColumns)) return {};

    const actualColumns = extractSelectionValue(columns);
    const isAllSelected =
        actualColumns === '*' ||
        (Array.isArray(actualColumns) && actualColumns.length === 0) ||
        (isPlainObject(actualColumns) && actualColumns['*'] === true) ||
        (defaultAll && (actualColumns === undefined || actualColumns === null));
    const result = isAllSelected ? getDirectFormulaColumns(formulaColumns) : {};

    if (Array.isArray(actualColumns)) {
        const selectedColumns = new Set(actualColumns.filter(column => typeof column === 'string'));
        for (const [key, value] of Object.entries(formulaColumns)) {
            if (isFormulaBindingValue(value) && selectedColumns.has(key)) result[key] = cloneSelectionValue(value);
        }
        return result;
    }

    if (!isPlainObject(actualColumns) || isFormulaBindingValue(actualColumns)) return result;

    for (const [key, value] of Object.entries(formulaColumns)) {
        if (key.startsWith('$')) continue;

        const columnValue = actualColumns[key];
        if (isFormulaBindingValue(value)) {
            if (isFormulaSelected(columnValue)) result[key] = cloneSelectionValue(value);
            continue;
        }

        const selectedValue = selectFormulaColumns(columnValue, value, false);
        if (isPlainObject(selectedValue) && Object.keys(selectedValue).length) result[key] = selectedValue;
    }

    return result;
}

export { extractSelectionValue };
