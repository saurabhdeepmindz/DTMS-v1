type FormulaHelper = {
    category: string;
    args: string[];
    min: number;
    max: number;
    result: 'number' | 'string' | 'boolean' | 'unknown';
    description: string;
};
const helper = (
    category: string,
    args: string[],
    min: number,
    result: FormulaHelper['result'],
    description: string,
    max = args.length
): FormulaHelper => ({ category, args, min, max, result, description });

/** Definitions of helpers available in frontend, backend JavaScript and SQL formulas. */
export const FORMULA_HELPER_DEFINITIONS = {
    addWorkdays: helper(
        'Date',
        ['date', 'days', 'holidays'],
        2,
        'string',
        'Adds working days, skipping weekends and optional ISO holidays (array or comma-separated text).'
    ),
    workdayDiff: helper(
        'Date',
        ['start', 'end', 'holidays'],
        2,
        'number',
        'Counts working days inclusively; reversed intervals return a negative count.'
    ),
} satisfies Record<string, FormulaHelper>;
