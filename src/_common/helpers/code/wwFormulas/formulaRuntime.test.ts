import { describe, expect, it } from 'vitest';
import { formulaRuntimeCases } from './formulaRuntime.cases';
import { createWwFormulas, WW_FORMULAS_CATEGORIES } from './core';
import { FORMULA_HELPER_DEFINITIONS } from './helperDefinitions';
const wwFormulas = createWwFormulas({ date: {}, getDataFromCollection: value => value });
it('registers all added helpers in the common frontend/backend picker', () => {
    const names = WW_FORMULAS_CATEGORIES.flatMap(c => c.values.map(v => v.name));
    for (const name of Object.keys(FORMULA_HELPER_DEFINITIONS)) expect(names.filter(n => n === name)).toHaveLength(1);
});
it.each([
    'workday',
    'exp',
    'regexMatch',
    'regexExtract',
    'regexReplace',
    'encodeUrlComponent',
    'countAll',
    'isAfter',
    'isBefore',
    'count',
    'countA',
    'log',
    'even',
    'odd',
    'roundUp',
    'roundDown',
    'ceiling',
    'floor',
    'xor',
    'error',
    'isError',
    'isSame',
    'fromNow',
    'toNow',
    'today',
    'parseDate',
    'formatDateLocale',
])('does not expose redundant wwFormulas.%s', name => {
    expect(Object.hasOwn(wwFormulas, name)).toBe(false);
    expect(WW_FORMULAS_CATEGORIES.flatMap(category => category.values.map(value => value.name))).not.toContain(name);
});
const evaluate = (code: string) => new Function('wwFormulas', 'return ' + code)(wwFormulas);
describe('public traditional formula runtime', () => {
    it.each(formulaRuntimeCases)('$name', ({ code, expected }) => {
        expect(evaluate(code)).toEqual(expected);
    });
    it('keeps existing helper behavior', () => {
        expect(wwFormulas.flat([[1, [2]], 3])).toEqual([1, [2], 3]);
    });
});

it('registers the workday date helpers in the public runtime', () => {
    expect(wwFormulas.addWorkdays('2024-05-24', 1)).toBe('2024-05-27T00:00:00.000Z');
    expect(wwFormulas.workdayDiff('2024-05-24', '2024-05-27')).toBe(2);
});
