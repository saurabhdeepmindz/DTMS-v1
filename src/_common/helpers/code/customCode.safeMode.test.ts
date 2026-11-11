import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { evaluateCode, evaluateFormula, executeCode } from './customCode';

vi.mock('@/pinia/integrations', () => ({
    useIntegrationsStore: () => ({ getCodeBindings: () => ({}) }),
}));

describe('formula execution across safe-mode levels', () => {
    const execute = vi.fn(() => 42);
    const state = {
        'safeMode': 0,
        'collections': {},
        'formulas': {},
        'pluginFormulas': {},
    };

    beforeEach(() => {
        execute.mockClear();
        vi.stubGlobal('__ww6088Execute', execute);
        vi.stubGlobal('wwLib', {
            WW_SAFE_MODE_SOFT: 1,
            WW_SAFE_MODE_HARD: 2,
            WW_SAFE_MODE_RECOVERY: 3,
            store: { manager: state, data: state, websiteData: state, integrations: { getCodeBindings: () => ({}) } },
            $pinia: {},
            globalContext: {},
            globalVariables: { customCodeVariables: {} },
            wwPlugins: {},
        });
    });

    afterEach(() => vi.unstubAllGlobals());

    it.each([0, 1])('executes formulas and custom code in mode %i', async mode => {
        state['safeMode'] = mode;
        expect(evaluateCode({ code: 'return globalThis.__ww6088Execute();', filter: undefined, sort: undefined, __wwmap: undefined }, {})).toEqual({ value: 42, rawValue: 42 });
        expect(evaluateFormula({ code: 'globalThis.__ww6088Execute()', filter: undefined, sort: undefined, __wwmap: undefined }, {})).toEqual({ value: 42, rawValue: 42 });
        expect(await executeCode('return globalThis.__ww6088Execute();', {})).toBe(42);
        expect(execute).toHaveBeenCalledTimes(3);
    });

    it.each([2, 3])('never executes formulas or custom code in mode %i', async mode => {
        state['safeMode'] = mode;
        expect(evaluateCode({ code: 'return globalThis.__ww6088Execute();', filter: undefined, sort: undefined, __wwmap: undefined }, {})).toEqual({});
        expect(evaluateFormula({ code: 'globalThis.__ww6088Execute()', filter: undefined, sort: undefined, __wwmap: undefined }, {})).toBe('');
        expect(await executeCode('return globalThis.__ww6088Execute();', {})).toBe('');
        expect(execute).not.toHaveBeenCalled();
    });
});
