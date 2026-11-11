import { describe, expect, it } from 'vitest';
import { applyVariableUpdate } from './updateVariable.js';

describe('applyVariableUpdate', () => {
    it('updates an object path without replacing the full object', () => {
        expect(
            applyVariableUpdate(
                { type: 'object' },
                { test: { previous: true }, keep: 'value' },
                { real: 'value' },
                { path: 'test' }
            )
        ).toEqual({
            test: { real: 'value' },
            keep: 'value',
        });
    });

    it('updates an array item path without replacing the full item', () => {
        expect(
            applyVariableUpdate(
                { type: 'array' },
                [{ test: { previous: true }, keep: 'value' }],
                { real: 'value' },
                { arrayUpdateType: 'update', index: 0, path: 'test' }
            )
        ).toEqual([
            {
                test: { real: 'value' },
                keep: 'value',
            },
        ]);
    });
});
