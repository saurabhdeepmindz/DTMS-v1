import { describe, expect, it } from 'vitest';

import {
    batchCssRuleMutations,
    deleteCssRuleFromParent,
    type CssRuleParent,
} from './styleCompilerCssRuleDeletionBatch';

describe('style compiler CSS rule deletion batch', () => {
    it('deletes queued rules in descending order after scanning a parent once', () => {
        const rules = Array.from({ length: 100 }, (_, index) => ({ index }) as unknown as CSSRule);
        const reads: number[] = [];
        const cssRules = new Proxy(rules, {
            get(target, property, receiver) {
                if (typeof property === 'string' && /^\d+$/.test(property)) reads.push(Number(property));
                return Reflect.get(target, property, receiver);
            },
        });
        const deletedIndices: number[] = [];
        const parent = {
            cssRules,
            deleteRule(index: number) {
                deletedIndices.push(index);
                rules.splice(index, 1);
            },
        } as unknown as CssRuleParent;

        batchCssRuleMutations(() => {
            deleteCssRuleFromParent(parent, rules[10]);
            deleteCssRuleFromParent(parent, rules[50]);
            deleteCssRuleFromParent(parent, rules[90]);
        });

        expect(deletedIndices).toEqual([90, 50, 10]);
        expect(reads).toHaveLength(100);
        expect(rules).toHaveLength(97);
    });

    it('shares the outer deletion batch with nested compiler mutations', () => {
        const rules = [{ index: 0 }, { index: 1 }] as unknown as CSSRule[];
        const parent = {
            cssRules: rules,
            deleteRule(index: number) {
                rules.splice(index, 1);
            },
        } as unknown as CssRuleParent;

        batchCssRuleMutations(() => {
            batchCssRuleMutations(() => deleteCssRuleFromParent(parent, rules[0]));
            expect(rules).toHaveLength(2);
        });

        expect(rules).toEqual([{ index: 1 }]);
    });
});
