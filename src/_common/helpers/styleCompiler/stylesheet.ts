import {
    serializeGroupingRule,
    serializeKeyframesRule,
    serializeLayerStatementRule,
    serializeRegisteredProperty,
    serializeStyleRule,
} from './serialization';
import type {
    StyleDeclarationPriority,
    StyleKeyframesRule,
    StyleLayerRule,
    StyleLayerStatementRule,
    StyleMediaRule,
    StyleRegisteredProperty,
    StyleRule,
    StyleRuleAdapter,
    StyleRuleContainerAdapter,
    StyleSheetAdapter,
    StyleStyleRule,
    StyleStyleRuleAdapter,
} from './types';

/**
 * Creates a dependency-free string-backed stylesheet adapter for tests and tooling.
 *
 * Production publisher output uses a CSSOM-compatible SheetOM adapter. This reference adapter
 * keeps a conservative serialization boundary without attempting full CSS grammar validation.
 */
export function createStringStyleSheetAdapter(): StyleSheetAdapter<string> {
    const root = createStringRuleContainerNode();
    const rootAdapter = createStringRuleContainerAdapter(root, () => {});
    const registeredProperties = createStringRegisteredPropertyStore();

    return {
        insertRule: rootAdapter.insertRule,
        dispose: rootAdapter.dispose,
        registerProperty: registeredProperties.registerProperty,
        result() {
            return serializeStringStyleSheet(root, registeredProperties.properties);
        },
    };
}

/**
 * Internal representation of one active string-backed rule tree node.
 */
type StringRuleNode = StringLayerStatementNode | StringGroupingNode | StringStyleNode | StringKeyframesNode;

type StringLayerStatementNode = {
    kind: 'layer-statement';
    rule: StyleLayerStatementRule;
};

type StringGroupingNode = {
    kind: 'layer' | 'media';
    rule: StyleLayerRule | StyleMediaRule;
    container: StringRuleContainerNode;
};

type StringStyleNode = {
    kind: 'style';
    rule: StyleStyleRule;
    declarations: Map<string, string>;
};

type StringKeyframesNode = {
    kind: 'keyframes';
    rule: StyleKeyframesRule;
};

type StringRuleContainerNode = {
    children: Map<string, StringRuleNode>;
    disposed: boolean;
};

type StringRegisteredPropertyStore = {
    properties: Map<string, StyleRegisteredProperty>;
    registerProperty(property: StyleRegisteredProperty): () => void;
};

function createStringRegisteredPropertyStore(): StringRegisteredPropertyStore {
    const properties = new Map<string, StyleRegisteredProperty>();
    const referenceCounts = new Map<string, number>();

    return {
        properties,
        registerProperty(property) {
            const count = referenceCounts.get(property.name) || 0;
            referenceCounts.set(property.name, count + 1);
            properties.set(property.name, property);

            return () => {
                const nextCount = (referenceCounts.get(property.name) || 1) - 1;
                if (nextCount > 0) {
                    referenceCounts.set(property.name, nextCount);
                    return;
                }

                referenceCounts.delete(property.name);
                properties.delete(property.name);
            };
        },
    };
}

function createStringRuleContainerNode(): StringRuleContainerNode {
    return {
        children: new Map(),
        disposed: false,
    };
}

function createStringRuleContainerAdapter(
    container: StringRuleContainerNode,
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
                return createStringLayerStatementRuleAdapter(container, rule);
            case 'layer':
            case 'media':
                return createStringGroupingRuleAdapter(container, rule);
            case 'style':
                return createStringStyleRuleAdapter(container, rule);
            case 'keyframes':
                return createStringKeyframesRuleAdapter(container, rule);
        }
    }

    return {
        insertRule,
        dispose() {
            if (container.disposed) return;

            container.disposed = true;
            container.children.clear();
            removeContainer();
        },
    };
}

function createStringLayerStatementRuleAdapter(
    container: StringRuleContainerNode,
    rule: StyleLayerStatementRule
): StyleRuleAdapter {
    if (!container.disposed) {
        container.children.set(getRuleNodeKey(rule), { kind: 'layer-statement', rule });
    }

    return {
        dispose() {
            container.children.delete(getRuleNodeKey(rule));
        },
    };
}

function createStringGroupingRuleAdapter(
    container: StringRuleContainerNode,
    rule: StyleLayerRule | StyleMediaRule
): StyleRuleContainerAdapter {
    const ruleNodeKey = getRuleNodeKey(rule);
    const existingNode = container.children.get(ruleNodeKey);
    if (existingNode?.kind === rule.kind) {
        return createStringRuleContainerAdapter(existingNode.container, () => {
            container.children.delete(ruleNodeKey);
        });
    }

    const nestedContainer = createStringRuleContainerNode();
    container.children.set(ruleNodeKey, {
        kind: rule.kind,
        rule,
        container: nestedContainer,
    });

    return createStringRuleContainerAdapter(nestedContainer, () => {
        container.children.delete(ruleNodeKey);
    });
}

function createStringKeyframesRuleAdapter(
    container: StringRuleContainerNode,
    rule: StyleKeyframesRule
): StyleRuleAdapter {
    if (!container.disposed) {
        container.children.set(getRuleNodeKey(rule), { kind: 'keyframes', rule });
    }

    return {
        dispose() {
            container.children.delete(getRuleNodeKey(rule));
        },
    };
}

function createStringStyleRuleAdapter(
    container: StringRuleContainerNode,
    rule: StyleStyleRule
): StyleStyleRuleAdapter {
    const declarations = new Map<string, string>();
    let disposed = false;

    return {
        style: {
            setProperty(cssProperty, cssValue, priority = '') {
                const entry = ensureEntry();
                if (!entry || !isStringAdapterDeclarationSafe(cssProperty, cssValue)) return false;

                const serializedValue = serializeDeclarationValue(cssValue, priority);
                declarations.set(cssProperty, serializedValue);
                entry.declarations.set(cssProperty, serializedValue);
                return true;
            },
            removeProperty(cssProperty) {
                declarations.delete(cssProperty);

                const entry = getStyleEntry(container, rule);
                if (!entry) return;

                entry.declarations.delete(cssProperty);
                if (!entry.declarations.size) {
                    container.children.delete(getRuleNodeKey(rule));
                }
            },
        },
        dispose() {
            if (disposed) return;

            disposed = true;
            declarations.clear();
            container.children.delete(getRuleNodeKey(rule));
        },
    };

    function ensureEntry() {
        if (disposed || container.disposed) return null;

        const existingEntry = getStyleEntry(container, rule);
        if (existingEntry) return existingEntry;

        const entry = {
            kind: 'style',
            rule,
            declarations: new Map(declarations),
        } satisfies StringStyleNode;
        container.children.set(getRuleNodeKey(rule), entry);
        return entry;
    }
}

function serializeDeclarationValue(cssValue: string, priority: StyleDeclarationPriority) {
    return priority ? `${cssValue} !important` : cssValue;
}

/**
 * Keeps the dependency-free string adapter from emitting extra declarations or rules.
 * Production grammar validation belongs to browser CSSOM or SheetOM adapters.
 */
function isStringAdapterDeclarationSafe(property: string, value: string) {
    const validProperty = property.startsWith('--')
        ? /^--[-_a-zA-Z0-9]+$/.test(property)
        : /^-?[_a-zA-Z][-_a-zA-Z0-9]*$/.test(property);
    if (!validProperty) return false;
    return !/[\u0000-\u001f{};]/.test(value) && !/<\/style/i.test(value);
}

/**
 * Serializes active rules recursively.
 */
function serializeStringStyleSheet(
    container: StringRuleContainerNode,
    registeredProperties: ReadonlyMap<string, StyleRegisteredProperty>
) {
    const propertyCss = [...registeredProperties.values()].map(serializeRegisteredProperty);
    const ruleCss = serializeStringRuleContainer(container);

    return [...propertyCss, ruleCss].filter(Boolean).join('\n\n');
}

function serializeStringRuleContainer(container: StringRuleContainerNode): string {
    const statementCss: string[] = [];
    const bodyCss: string[] = [];

    for (const node of container.children.values()) {
        if (node.kind === 'layer-statement') {
            statementCss.push(serializeLayerStatementRule(node.rule));
            continue;
        }

        const css = serializeStringRuleNode(node);
        if (css) bodyCss.push(css);
    }

    if (!bodyCss.length) return '';

    return [...statementCss, ...bodyCss].join('\n\n');
}

function serializeStringRuleNode(node: Exclude<StringRuleNode, StringLayerStatementNode>) {
    if (node.kind === 'style') {
        return serializeStyleRule(node.rule, node.declarations);
    }

    if (node.kind === 'keyframes') {
        return serializeKeyframesRule(node.rule);
    }

    return serializeGroupingRule(node.rule, serializeStringRuleContainer(node.container));
}

function getStyleEntry(container: StringRuleContainerNode, rule: StyleStyleRule) {
    const entry = container.children.get(getRuleNodeKey(rule));
    return entry?.kind === 'style' ? entry : null;
}

function getRuleNodeKey(rule: Pick<StyleRule, 'kind' | 'key'>) {
    return `${rule.kind}:${rule.key}`;
}
