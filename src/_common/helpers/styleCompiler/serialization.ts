import type {
    StyleLayerRule,
    StyleLayerStatementRule,
    StyleMediaRule,
    StyleRegisteredProperty,
    StyleRule,
    StyleKeyframesRule,
    StyleDynamicVariableReference,
    StyleStringifiedDynamicVariableReference,
    StyleStyleRule,
} from './types';
import { normalizeCssProperty, serializeCssValue } from './cssValue';
import { isStyleDynamicVariableReference } from './values';

export {
    normalizeCssProperty,
    serializeCssValue,
    serializeRuntimeCssVariableValue,
    splitLegacyCssPriority,
} from './cssValue';

/**
 * Converts a JS-style property name into the CSS name consumed by the backing CSSOM.
 */
export function serializeCssProperty(property: string) {
    const normalizedProperty = normalizeCssProperty(property.trim());
    return normalizedProperty || undefined;
}

/** Converts a supported WeWeb value before the backing CSSOM validates its CSS grammar. */
export function serializeCssDeclarationValue(cssProperty: string, value: unknown) {
    if (isStyleDynamicVariableReference(value)) return value.toCssText(cssProperty);

    return serializeCssValue(value);
}

/**
 * Registers dynamic sinks only after the declaration has been accepted by its backing CSSOM.
 */
export function registerCssDeclarationDynamicReferences(
    cssProperty: string,
    value: unknown,
    cssValue: string,
    options: { selector?: string; dynamicReferences?: readonly StyleStringifiedDynamicVariableReference[] }
) {
    if (isStyleDynamicVariableReference(value)) {
        value.register({
            cssProperty,
            validationProperty: cssProperty,
            selector: options.selector,
            directDeclaration: true,
        });
        registerNestedDynamicReferences(cssProperty, value, options, new Set([createDynamicReferenceKey(value)]));
        return;
    }
    if (!options.dynamicReferences?.length) return;

    const registeredReferences = new Set<string>();
    for (const occurrence of options.dynamicReferences) {
        if (!cssValue.includes(occurrence.cssText)) continue;

        registerDynamicReference(cssProperty, occurrence.reference, options, registeredReferences);
    }
}

/** Registers every dynamic variable reachable through conditional layout gates. */
function registerNestedDynamicReferences(
    cssProperty: string,
    value: StyleDynamicVariableReference,
    options: { selector?: string; dynamicReferences?: readonly StyleStringifiedDynamicVariableReference[] },
    registeredReferences: Set<string>
) {
    if (
        value.variable.domain !== 'content' ||
        !value.variable.outputKey?.startsWith('layout-') ||
        !options.dynamicReferences?.length ||
        typeof value.variable.value !== 'string'
    ) {
        return;
    }

    for (const occurrence of options.dynamicReferences) {
        const variablePrefix = `var(${occurrence.reference.name}`;
        if (
            !value.variable.value.includes(`${variablePrefix},`) &&
            !value.variable.value.includes(`${variablePrefix})`)
        ) {
            continue;
        }

        registerDynamicReference(cssProperty, occurrence.reference, options, registeredReferences);
    }
}

function registerDynamicReference(
    cssProperty: string,
    reference: StyleDynamicVariableReference,
    options: { selector?: string; dynamicReferences?: readonly StyleStringifiedDynamicVariableReference[] },
    registeredReferences: Set<string>
) {
    const key = createDynamicReferenceKey(reference);
    if (registeredReferences.has(key)) return;

    registeredReferences.add(key);
    reference.register({ cssProperty, selector: options.selector });
    registerNestedDynamicReferences(cssProperty, reference, options, registeredReferences);
}

function createDynamicReferenceKey(reference: StyleDynamicVariableReference) {
    const variable = reference.variable;
    return [
        variable.name,
        variable.sourceUid,
        variable.domain,
        variable.property,
        variable.state,
        variable.breakpoint,
    ].join('\u001f');
}

/**
 * Escapes a string for use in a CSS identifier.
 */
export function escapeCssIdentifier(value: string) {
    return value.replace(/(^-?\d)|[^a-zA-Z0-9_-]/g, (char, firstDigit) => {
        if (firstDigit) return `\\3${char} `;

        const codePoint = char.codePointAt(0)?.toString(16) || '0';
        return `\\${codePoint} `;
    });
}

/**
 * Escapes a string for use in a quoted CSS string.
 */
export function escapeCssString(value: string) {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\a ');
}

/**
 * Creates an empty CSS rule text for CSSOM insertion.
 */
export function createCssRuleText(rule: StyleRule) {
    // Used by DOM adapters when creating an empty CSSOM rule before setting declarations through
    // `CSSStyleRule.style`.
    switch (rule.kind) {
        case 'layer-statement':
            return createLayerStatementRuleCss(rule);
        case 'layer':
            return `@layer ${rule.name} {}`;
        case 'media':
            return `@media ${formatMediaQuery(rule.query)} {}`;
        case 'style':
            return `${rule.selector} {}`;
        case 'keyframes':
            // Keyframes carry no declaration API; the full validated block is inserted at once.
            return rule.css;
    }
}

/**
 * Serializes an author-written `@keyframes` block (name already rewritten to the element scope).
 */
export function serializeKeyframesRule(rule: StyleKeyframesRule) {
    return rule.css.trim();
}

/**
 * Serializes a complete CSS rule with declarations.
 */
export function serializeStyleRule(rule: StyleStyleRule, declarations: ReadonlyMap<string, string>) {
    // Used by string adapters/publisher output where declarations are emitted as text directly.
    if (!declarations.size) return '';

    return `${rule.selector} {\n${serializeDeclarations(declarations)}\n}`;
}

/**
 * Serializes a grouping rule with already-serialized child CSS.
 */
export function serializeGroupingRule(rule: StyleLayerRule | StyleMediaRule, css: string) {
    const trimmedCss = css.trim();
    if (!trimmedCss) return '';

    const ruleStart = rule.kind === 'layer' ? `@layer ${rule.name}` : `@media ${formatMediaQuery(rule.query)}`;
    return `${ruleStart} {\n${indentCss(trimmedCss)}\n}`;
}

/**
 * Serializes one layer-order statement.
 */
export function serializeLayerStatementRule(rule: StyleLayerStatementRule) {
    return createLayerStatementRuleCss(rule);
}

/**
 * Serializes a compiler-owned dynamic custom property registration.
 */
export function serializeRegisteredProperty(property: StyleRegisteredProperty) {
    return `@property ${property.name} {\n  syntax: \"${property.syntax}\";\n  inherits: ${property.inherits ? 'true' : 'false'};\n}`;
}

function createLayerStatementRuleCss(rule: StyleLayerStatementRule) {
    return `@layer ${rule.names.join(', ')};`;
}

/**
 * Normalizes a media query value so callers can pass either `max-width: ...`, `(max-width: ...)`,
 * or `@media (...)`.
 */
export function formatMediaQuery(mediaQuery: string) {
    const query = mediaQuery.trim();
    if (query.startsWith('@media')) return query.slice('@media'.length).trim();
    if (query.startsWith('(')) return query;
    return `(${query})`;
}

/**
 * Indents multiline CSS for nested media query serialization.
 */
export function indentCss(css: string) {
    return css
        .split('\n')
        .map(line => (line ? `  ${line}` : line))
        .join('\n');
}

/**
 * Serializes CSS declarations in insertion order.
 */
function serializeDeclarations(declarations: ReadonlyMap<string, string>) {
    return [...declarations.entries()].map(([property, value]) => `  ${property}: ${value};`).join('\n');
}
