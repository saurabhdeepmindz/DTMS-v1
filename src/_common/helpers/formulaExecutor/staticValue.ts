import type { FormulaExecutionResult, FormulaValue } from './types';

/**
 * Reads the static value explicitly attached to a formula.
 *
 * `undefined` means that no usable value was configured, so callers may attempt restricted static
 * evaluation. Other falsy values, including `null`, remain valid explicit static values.
 */
export function getFormulaStaticValue(formula: unknown): FormulaExecutionResult | undefined {
    if (!formula || typeof formula !== 'object' || Array.isArray(formula)) return undefined;

    const value = formula as FormulaValue;
    const type = value.__wwtype || value.type;
    if (type !== 'f' || !Object.hasOwn(value, 'staticValue') || value.staticValue === undefined) return undefined;

    return { status: 'resolved', value: value.staticValue };
}
