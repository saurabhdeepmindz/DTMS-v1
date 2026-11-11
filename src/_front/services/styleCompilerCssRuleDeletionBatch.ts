export type CssRuleParent = CSSStyleSheet | CSSGroupingRule;

let activeRuleDeletionBatch: Map<CssRuleParent, Set<CSSRule>> | null = null;

export function deleteCssRuleFromParent(parent: CssRuleParent, rule: CSSRule) {
    if (activeRuleDeletionBatch) {
        const rules = activeRuleDeletionBatch.get(parent) || new Set<CSSRule>();
        rules.add(rule);
        activeRuleDeletionBatch.set(parent, rules);
        return;
    }

    const index = Array.prototype.indexOf.call(parent.cssRules, rule);
    if (index !== -1) parent.deleteRule(index);
}

export function batchCssRuleMutations(callback: () => void) {
    if (activeRuleDeletionBatch) {
        callback();
        return;
    }

    const batch = new Map<CssRuleParent, Set<CSSRule>>();
    activeRuleDeletionBatch = batch;
    try {
        callback();
    } finally {
        activeRuleDeletionBatch = null;
        flushRuleDeletionBatch(batch);
    }
}

function flushRuleDeletionBatch(batch: Map<CssRuleParent, Set<CSSRule>>) {
    for (const [parent, rules] of batch) {
        const indices: number[] = [];
        for (let index = 0; index < parent.cssRules.length; index += 1) {
            if (rules.has(parent.cssRules[index])) indices.push(index);
        }

        for (let index = indices.length - 1; index >= 0; index -= 1) {
            try {
                parent.deleteRule(indices[index]);
            } catch (error) {
                wwLib.wwLog.warn('[style-compiler] failed to batch delete CSS rule', { error });
            }
        }
    }
}
