import { createCssRuleText, serializeRegisteredProperty } from '@/_common/helpers/styleCompiler/serialization';
import {
    type StyleDeclarationPriority,
    type StyleDiagnostic,
    type StyleKeyframesRule,
    type StyleLayerRule,
    type StyleLayerStatementRule,
    type StyleMediaRule,
    type StyleRegisteredProperty,
    type StyleRule,
    type StyleRuleAdapter,
    type StyleRuleContainerAdapter,
    type StyleSheetAdapter,
    type StyleStyleRule,
    type StyleStyleRuleAdapter,
} from '@/_common/helpers/styleCompiler';
import { registerStyleDynamicVariable } from './styleCompilerRuntimeVariables';
import { registerStyleAtomicClass } from './styleCompilerAtomicClasses';
import {
    batchCssRuleMutations,
    deleteCssRuleFromParent,
    type CssRuleParent,
} from './styleCompilerCssRuleDeletionBatch';

const styleSheetsByDocument = new WeakMap<Document, LayeredStyleSheetState>();
const styleValidationProbesByDocument = new WeakMap<Document, CSSStyleDeclaration>();

type LayeredStyleSheetState = {
    sheet: CSSStyleSheet;
    root: DomRuleContainerState;
    registeredProperties: Map<string, CSSRule>;
    failedRegisteredProperties: Set<string>;
};

type DomRuleNode = DomLayerStatementNode | DomGroupingNode | DomKeyframesNode;

type DomLayerStatementNode = {
    kind: 'layer-statement';
    rule: CSSRule;
};

type DomKeyframesNode = {
    kind: 'keyframes';
    rule: CSSRule;
};

type DomGroupingNode = {
    kind: 'layer' | 'media';
    rule: CSSGroupingRule;
    container: DomRuleContainerState;
};

type DomRuleContainerState = {
    parent: CssRuleParent;
    children: Map<string, DomRuleNode>;
    disposed: boolean;
};

/**
 * Creates a CSSOM-backed adapter for the editor/front document.
 */
export function createDomStyleSheetAdapter(): StyleSheetAdapter<readonly CSSStyleSheet[]> {
    const rootAdapter = createDomRuleContainerAdapter(getRootContainer, () => {});

    return {
        insertRule: rootAdapter.insertRule,
        dispose: rootAdapter.dispose,
        diagnostic(diagnostic) {
            reportStyleDiagnostic(diagnostic);
        },
        dynamicVariable(variable) {
            return registerStyleDynamicVariable(variable);
        },
        atomicClass(assignment) {
            return registerStyleAtomicClass(assignment);
        },
        registerProperty(property) {
            registerDomStyleProperty(property);
        },
        batch: batchCssRuleMutations,
        result: getStyleSheets,
    };
}

function createDomRuleContainerAdapter(
    getContainer: () => DomRuleContainerState | null,
    removeContainer: () => void
): StyleRuleContainerAdapter {
    function insertRule(rule: StyleLayerStatementRule): StyleRuleAdapter;
    function insertRule(rule: StyleLayerRule): StyleRuleContainerAdapter;
    function insertRule(rule: StyleMediaRule): StyleRuleContainerAdapter;
    function insertRule(rule: StyleStyleRule): StyleStyleRuleAdapter;
    function insertRule(rule: StyleKeyframesRule): StyleRuleAdapter;
    function insertRule(rule: StyleRule) {
        switch (rule.kind) {
            case 'layer-statement':
                return createDomLayerStatementRuleAdapter(getContainer, rule);
            case 'layer':
            case 'media':
                return createDomGroupingRuleAdapter(getContainer, rule);
            case 'style':
                return createDomStyleRuleAdapter(getContainer, rule);
            case 'keyframes':
                return createDomKeyframesRuleAdapter(getContainer, rule);
        }
    }

    return {
        insertRule,
        dispose() {
            const container = getContainer();
            if (!container || container.disposed) return;

            container.disposed = true;
            container.children.clear();
            removeContainer();
        },
    };
}

function createDomLayerStatementRuleAdapter(
    getContainer: () => DomRuleContainerState | null,
    rule: StyleLayerStatementRule
): StyleRuleAdapter {
    const node = ensureDomRuleNode(getContainer, rule);

    return {
        dispose() {
            if (!node || node.kind !== 'layer-statement') return;

            const container = getContainer();
            if (!container) return;

            deleteCssRuleFromParent(container.parent, node.rule);
            container.children.delete(getRuleNodeKey(rule));
        },
    };
}

function createDomKeyframesRuleAdapter(
    getContainer: () => DomRuleContainerState | null,
    rule: StyleKeyframesRule
): StyleRuleAdapter {
    const node = ensureDomKeyframesNode(getContainer, rule);

    return {
        dispose() {
            if (!node) return;

            const container = getContainer();
            if (!container) return;

            deleteCssRuleFromParent(container.parent, node.rule);
            container.children.delete(getRuleNodeKey(rule));
        },
    };
}

function createDomGroupingRuleAdapter(
    getContainer: () => DomRuleContainerState | null,
    rule: StyleLayerRule | StyleMediaRule
): StyleRuleContainerAdapter {
    const node = ensureDomRuleNode(getContainer, rule);
    if (!node || node.kind !== rule.kind) return createNoopDomRuleContainerAdapter();

    return createDomRuleContainerAdapter(
        () => node.container,
        () => {
            const container = getContainer();
            if (!container) return;

            deleteCssRuleFromParent(container.parent, node.rule);
            container.children.delete(getRuleNodeKey(rule));
        }
    );
}

function createDomStyleRuleAdapter(
    getContainer: () => DomRuleContainerState | null,
    rule: StyleStyleRule
): StyleStyleRuleAdapter {
    const declarations = new Map<string, { value: string; priority: StyleDeclarationPriority }>();
    let disposed = false;
    let topRule: CSSRule | null = null;
    let styleRule: CSSStyleRule | null = null;

    return {
        style: {
            setProperty(cssProperty, cssValue, priority = '') {
                if (disposed || !isDomStylePropertyAccepted(cssProperty, cssValue, priority)) return false;

                declarations.set(cssProperty, { value: cssValue, priority });
                const styleRule = ensureRule();
                if (!styleRule) {
                    declarations.delete(cssProperty);
                    return false;
                }

                styleRule.style.setProperty(cssProperty, cssValue, priority);
                return true;
            },
            removeProperty(cssProperty) {
                declarations.delete(cssProperty);
                styleRule?.style.removeProperty(cssProperty);

                if (!declarations.size) {
                    deleteMaterializedRule();
                }
            },
        },
        dispose() {
            if (disposed) return;

            disposed = true;
            declarations.clear();
            deleteMaterializedRule();
        },
    };

    function ensureRule() {
        if (styleRule) return styleRule;

        const container = getContainer();
        if (!container || container.disposed) return null;

        try {
            const index = container.parent.cssRules.length;
            container.parent.insertRule(createCssRuleText(rule), index);
            topRule = container.parent.cssRules[index] || null;
            styleRule = getNestedStyleRule(topRule);

            for (const [property, declaration] of declarations) {
                styleRule?.style.setProperty(property, declaration.value, declaration.priority);
            }
        } catch (error) {
            wwLib.wwLog.warn('[style-compiler] failed to insert CSS rule', { rule, error });
            return null;
        }

        return styleRule;
    }

    function deleteMaterializedRule() {
        const container = getContainer();
        if (!container || !topRule) {
            topRule = null;
            styleRule = null;
            return;
        }

        try {
            deleteCssRuleFromParent(container.parent, topRule);
        } catch (error) {
            wwLib.wwLog.warn('[style-compiler] failed to delete CSS rule', { rule, error });
        } finally {
            topRule = null;
            styleRule = null;
        }
    }
}

/**
 * Probes the browser's own CSSStyleDeclaration before mutating a live generated rule.
 *
 * The isolated declaration keeps an invalid shorthand from disturbing related longhands already
 * present on the live rule while preserving browser-specific syntax recovery.
 */
function isDomStylePropertyAccepted(property: string, value: string, priority: StyleDeclarationPriority) {
    const doc = wwLib.getFrontDocument?.() || document;
    let style = styleValidationProbesByDocument.get(doc);
    if (!style) {
        style = doc.createElement('div').style;
        styleValidationProbesByDocument.set(doc, style);
    }

    style.cssText = '';
    style.setProperty(property, value, priority);
    return style.length > 0;
}

function getStyleSheets() {
    const doc = wwLib.getFrontDocument?.() || document;
    if (!doc.head) return [];

    const state = styleSheetsByDocument.get(doc);
    return state ? [state.sheet] : [];
}

function getRootContainer() {
    const doc = wwLib.getFrontDocument?.() || document;
    if (!doc.head) return null;

    return getStyleSheetState(doc)?.root || null;
}

function getStyleSheetState(doc: Document) {
    const cachedState = styleSheetsByDocument.get(doc);
    if (cachedState) return cachedState;
    if (!doc.head) return null;

    const styleElement = doc.createElement('style');
    styleElement.setAttribute('type', 'text/css');
    styleElement.setAttribute('data-ww-style-compiler', '');
    doc.head.appendChild(styleElement);

    const sheet = styleElement.sheet;
    if (!sheet) {
        styleElement.remove();
        return null;
    }

    const state = {
        sheet,
        root: {
            parent: sheet,
            children: new Map(),
            disposed: false,
        },
        registeredProperties: new Map(),
        failedRegisteredProperties: new Set(),
    } satisfies LayeredStyleSheetState;
    styleSheetsByDocument.set(doc, state);
    return state;
}

function registerDomStyleProperty(property: StyleRegisteredProperty) {
    const doc = wwLib.getFrontDocument?.() || document;
    if (!doc.head) return;

    const state = getStyleSheetState(doc);
    if (!state) return;
    if (state.registeredProperties.has(property.name) || state.failedRegisteredProperties.has(property.name)) return;

    try {
        const index = state.registeredProperties.size;
        state.sheet.insertRule(serializeRegisteredProperty(property), index);
        const rule = state.sheet.cssRules[index] || null;
        if (!rule) throw new Error(`CSS property registration was not created for ${property.name}.`);

        state.registeredProperties.set(property.name, rule);
    } catch (error) {
        state.failedRegisteredProperties.add(property.name);
        wwLib.wwLog.warn('[style-compiler] failed to register CSS property', { property, error });
    }
}

function isCssGroupingRule(doc: Document, rule: CSSRule | null): rule is CSSGroupingRule {
    if (!rule) return false;

    const GroupingRule = doc.defaultView?.CSSGroupingRule;
    if (GroupingRule && rule instanceof GroupingRule) return true;

    return 'cssRules' in rule && 'insertRule' in rule && 'deleteRule' in rule;
}

function ensureDomRuleNode(
    getContainer: () => DomRuleContainerState | null,
    rule: StyleLayerStatementRule | StyleLayerRule | StyleMediaRule
) {
    const container = getContainer();
    if (!container || container.disposed) return null;

    const ruleNodeKey = getRuleNodeKey(rule);
    const existingNode = container.children.get(ruleNodeKey);
    if (existingNode?.kind === rule.kind) return existingNode;

    try {
        const index = container.parent.cssRules.length;
        container.parent.insertRule(createCssRuleText(rule), index);
        const cssRule = container.parent.cssRules[index] || null;

        if (rule.kind === 'layer-statement') {
            if (!cssRule) throw new Error('CSS layer statement was not created.');

            const node = { kind: 'layer-statement', rule: cssRule } satisfies DomLayerStatementNode;
            container.children.set(ruleNodeKey, node);
            return node;
        }

        const doc = wwLib.getFrontDocument?.() || document;
        if (!isCssGroupingRule(doc, cssRule)) {
            throw new Error(`CSS grouping rule was not created for ${rule.kind}.`);
        }

        const node = {
            kind: rule.kind,
            rule: cssRule,
            container: {
                parent: cssRule,
                children: new Map(),
                disposed: false,
            },
        } satisfies DomGroupingNode;
        container.children.set(ruleNodeKey, node);
        return node;
    } catch (error) {
        wwLib.wwLog.warn('[style-compiler] failed to insert CSS rule', { rule, error });
        return null;
    }
}

function ensureDomKeyframesNode(getContainer: () => DomRuleContainerState | null, rule: StyleKeyframesRule) {
    const container = getContainer();
    if (!container || container.disposed) return null;

    const ruleNodeKey = getRuleNodeKey(rule);
    const existingNode = container.children.get(ruleNodeKey);
    if (existingNode?.kind === 'keyframes') return existingNode;

    try {
        const index = container.parent.cssRules.length;
        // The full `@keyframes` block is parsed by CSSOM in one shot (createCssRuleText returns it).
        container.parent.insertRule(createCssRuleText(rule), index);
        const cssRule = container.parent.cssRules[index] || null;
        if (!cssRule) throw new Error(`CSS keyframes rule was not created for ${rule.name}.`);

        const node = { kind: 'keyframes', rule: cssRule } satisfies DomKeyframesNode;
        container.children.set(ruleNodeKey, node);
        return node;
    } catch (error) {
        wwLib.wwLog.warn('[style-compiler] failed to insert CSS rule', { rule, error });
        return null;
    }
}

function createNoopDomRuleContainerAdapter(): StyleRuleContainerAdapter {
    function insertRule(rule: StyleLayerStatementRule): StyleRuleAdapter;
    function insertRule(rule: StyleLayerRule): StyleRuleContainerAdapter;
    function insertRule(rule: StyleMediaRule): StyleRuleContainerAdapter;
    function insertRule(rule: StyleStyleRule): StyleStyleRuleAdapter;
    function insertRule(rule: StyleKeyframesRule): StyleRuleAdapter;
    function insertRule(rule: StyleRule) {
        if (rule.kind === 'style') return createNoopDomStyleRuleAdapter();
        if (rule.kind === 'layer-statement' || rule.kind === 'keyframes') return { dispose() {} };
        return createNoopDomRuleContainerAdapter();
    }

    return {
        insertRule,
        dispose() {},
    };
}

function createNoopDomStyleRuleAdapter(): StyleStyleRuleAdapter {
    return {
        style: {
            setProperty() {
                return false;
            },
            removeProperty() {},
        },
        dispose() {},
    };
}

function getNestedStyleRule(rule: CSSRule | null): CSSStyleRule | null {
    if (!rule) return null;
    if ('style' in rule) return rule as CSSStyleRule;
    if (!('cssRules' in rule)) return null;

    const nestedRule = rule.cssRules[0];
    return nestedRule && 'style' in nestedRule ? (nestedRule as CSSStyleRule) : null;
}

function reportStyleDiagnostic(diagnostic: StyleDiagnostic) {
    wwLib.wwLog.warn(`[style-compiler] ${diagnostic.message}`, diagnostic);
}

function getRuleNodeKey(rule: Pick<StyleRule, 'kind' | 'key'>) {
    return `${rule.kind}:${rule.key}`;
}
