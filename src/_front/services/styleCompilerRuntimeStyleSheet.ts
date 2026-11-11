import {
    STYLE_BREAKPOINTS,
    STYLE_LIBRARY_LAYER_ORDER,
    STYLE_RULE_GROUP_LAYERS,
    STYLE_RULE_GROUPS,
    STYLE_RUNTIME_LAYER,
    splitLegacyCssPriority,
    type StyleDeclarationPriority,
    type StyleDynamicVariable,
    type StyleLibraryLayer,
    type StyleRuleGroup,
    type StyleScopeStop,
} from '@/_common/helpers/styleCompiler';
import { rewriteAnimationKeyframes } from '@/_common/helpers/styleCompiler/keyframes';
import { escapeCssString, formatMediaQuery } from '@/_common/helpers/styleCompiler/serialization';
import { splitCssSelectorList } from '@/_common/helpers/styleCompiler/selectors';
import { WW_COMPONENT_ID_ATTRIBUTE } from './componentIds';

type RuntimeStyleSheetState = {
    sheet: CSSStyleSheet;
    runtimeLayer: CSSGroupingRule | null;
    groupLayers: Map<StyleRuleGroup, CSSGroupingRule>;
    libraryLayers: Map<StyleLibraryLayer, CSSGroupingRule>;
    hasLibraryLayerOrder: boolean;
    mediaLayers: Map<string, CSSGroupingRule>;
    styleRules: Map<string, RuntimeStyleRuleState>;
    failedRules: Set<string>;
    clearGroupLayers: Map<StyleRuleGroup, CSSGroupingRule>;
    clearLibraryLayers: Map<StyleLibraryLayer, CSSGroupingRule>;
    hasClearLibraryLayerOrder: boolean;
    clearMediaLayers: Map<string, CSSGroupingRule>;
    clearStyleRules: Map<string, RuntimeStyleRuleState>;
    failedClearRules: Set<string>;
};

type RuntimeStyleRuleState = {
    key: string;
    parent: CSSStyleSheet | CSSGroupingRule;
    rule: CSSStyleRule;
    declarationsByProperty: Map<string, Map<string, RuntimeStyleDeclaration>>;
};

type RuntimeStyleDeclaration = {
    value: string;
    priority: StyleDeclarationPriority;
};

type SetStyleCompilerRuntimeVariableOptions = {
    componentId: string;
    variable: StyleDynamicVariable;
    cssValue: string;
};

type SetStyleCompilerRuntimeClearOptions = Omit<SetStyleCompilerRuntimeVariableOptions, 'cssValue'>;

type StyleDynamicKeyframesVariable = Extract<StyleDynamicVariable, { kind: 'keyframes' }>;

type SetStyleCompilerRuntimeKeyframesOptions = Omit<SetStyleCompilerRuntimeVariableOptions, 'variable'> & {
    state: RuntimeStyleSheetState;
    variable: StyleDynamicKeyframesVariable;
};

const runtimeStyleSheetsByDocument = new WeakMap<Document, RuntimeStyleSheetState>();

/** Serializes the render-scoped runtime sheet without retaining formulas or their contexts. */
export function serializeStyleCompilerRuntimeStyleSheet(
    doc: Document = wwLib.getFrontDocument?.() || document
): string {
    const state = runtimeStyleSheetsByDocument.get(doc);
    if (!state) return '';

    return Array.from(state.sheet.cssRules, rule => rule.cssText).join('\n');
}

/**
 * Writes one resolved formula value into the runtime stylesheet.
 */
export function setStyleCompilerRuntimeVariable({
    componentId,
    variable,
    cssValue,
}: SetStyleCompilerRuntimeVariableOptions): StyleScopeStop {
    const doc = wwLib.getFrontDocument?.() || document;
    if (!doc.head) return () => {};

    const state = getRuntimeStyleSheetState(doc);
    if (!state) return () => {};

    if (isStyleDynamicKeyframesVariable(variable)) {
        return setRuntimeKeyframes({ state, componentId, variable, cssValue });
    }

    const selector = createRuntimeVariableSelector(variable, componentId);
    const ruleState = ensureRuntimeStyleRule(state, variable, selector);
    if (!ruleState) return () => {};

    const registrationKey = createStyleCompilerRuntimeVariableRegistrationKey(componentId, variable);
    const declaration = splitLegacyCssPriority(
        variable.directDeclaration ? variable.cssProperty : variable.name,
        cssValue
    );
    const property = declaration.priority ? variable.cssProperty : variable.name;
    setRuntimeDeclaration(ruleState, property, registrationKey, declaration.value, declaration.priority);

    return () => {
        removeRuntimeDeclaration(state.styleRules, ruleState, property, registrationKey);
    };
}

/**
 * Validates a resolved value against the grammar of the CSS value fragment it represents.
 *
 * Keyframes are parsed separately. Older runtimes without CSS.supports keep the historical
 * fail-open behavior and let their CSS engine consume the custom property.
 */
export function isStyleCompilerRuntimeVariableValueAccepted(variable: StyleDynamicVariable, cssValue: string) {
    if (isStyleDynamicKeyframesVariable(variable)) return true;
    if (!variable.validationProperty) return true;

    const doc = wwLib.getFrontDocument?.() || document;
    const css = doc.defaultView?.CSS || globalThis.CSS;
    if (!css?.supports) return true;

    const declaration = splitLegacyCssPriority(
        variable.directDeclaration ? variable.cssProperty : variable.name,
        cssValue
    );
    return css.supports(variable.validationProperty, declaration.value);
}

/**
 * Masks one conditional runtime variable at its breakpoint without clearing the generated property.
 *
 * The generated declaration can contain several conditional variable fallbacks (for example flex
 * then grid). Clearing the property itself would also erase an active declaration from another
 * family. Masking only this variable lets the fallback chain select the active family while
 * preventing a value from a wider breakpoint from cascading into this one.
 */
export function setStyleCompilerRuntimeVariableClear({
    componentId,
    variable,
}: SetStyleCompilerRuntimeClearOptions): StyleScopeStop {
    const doc = wwLib.getFrontDocument?.() || document;
    if (!doc.head) return () => {};

    const state = getRuntimeStyleSheetState(doc);
    if (!state) return () => {};

    const selector = createRuntimeVariableSelector(variable, componentId);
    const ruleState = ensureRuntimeStyleRule(state, variable, selector);
    if (!ruleState) return () => {};

    const registrationKey = createStyleCompilerRuntimeVariableRegistrationKey(componentId, variable);
    setRuntimeDeclaration(ruleState, variable.name, registrationKey, 'revert-layer');

    return () => {
        removeRuntimeDeclaration(state.styleRules, ruleState, variable.name, registrationKey);
    };
}

/**
 * Clears one generated declaration while preserving the static stylesheet as an unresolved fallback.
 *
 * The declaration is written into the same named cascade layer as its generated counterpart. This
 * makes `revert-layer` expose styles below that generated layer, matching the legacy runtime's
 * omission semantics without recompiling or mutating static CSS.
 */
export function setStyleCompilerRuntimeClear({
    componentId,
    variable,
}: SetStyleCompilerRuntimeClearOptions): StyleScopeStop {
    const doc = wwLib.getFrontDocument?.() || document;
    if (!doc.head) return () => {};

    const state = getRuntimeStyleSheetState(doc);
    if (!state) return () => {};

    const selector = createRuntimeVariableSelector(variable, componentId);
    const ruleState = ensureRuntimeClearStyleRule(state, variable, selector);
    if (!ruleState) return () => {};

    const registrationKey = createStyleCompilerRuntimeVariableRegistrationKey(componentId, variable);
    setRuntimeDeclaration(ruleState, variable.cssProperty, registrationKey, 'revert-layer');

    return () => {
        removeRuntimeDeclaration(state.clearStyleRules, ruleState, variable.cssProperty, registrationKey);
    };
}

function isStyleDynamicKeyframesVariable(variable: StyleDynamicVariable): variable is StyleDynamicKeyframesVariable {
    return variable.kind === 'keyframes';
}

function setRuntimeKeyframes({
    state,
    componentId,
    variable,
    cssValue,
}: SetStyleCompilerRuntimeKeyframesOptions): StyleScopeStop {
    const runtimeName = `${variable.keyframesName}-${normalizeKeyframesNamePart(componentId)}`;
    const keyframesCss = rewriteAnimationKeyframes(cssValue, runtimeName);
    if (!keyframesCss) return () => {};

    const keyframesParent = ensureRuntimeLayer(state);
    if (!keyframesParent) return () => {};

    let keyframesRule: CSSRule;
    try {
        const index = keyframesParent.cssRules.length;
        keyframesParent.insertRule(keyframesCss, index);
        const insertedRule = keyframesParent.cssRules[index] || null;
        if (!insertedRule) throw new Error('Runtime keyframes rule was not created.');
        keyframesRule = insertedRule;
    } catch (error) {
        wwLib.wwLog.warn('[style-compiler] failed to insert runtime keyframes rule', { variable, error });
        return () => {};
    }

    const selector = createRuntimeVariableSelector(variable, componentId);
    const ruleState = ensureRuntimeStyleRule(state, variable, selector);
    if (!ruleState) {
        deleteCssRule(keyframesParent, keyframesRule);
        return () => {};
    }

    const registrationKey = createStyleCompilerRuntimeVariableRegistrationKey(componentId, variable);
    setRuntimeDeclaration(ruleState, variable.name, registrationKey, runtimeName);

    return () => {
        removeRuntimeDeclaration(state.styleRules, ruleState, variable.name, registrationKey);
        deleteCssRule(keyframesParent, keyframesRule);
    };
}

function getRuntimeStyleSheetState(doc: Document) {
    const cachedState = runtimeStyleSheetsByDocument.get(doc);
    if (cachedState) return cachedState;
    if (!doc.head) return null;

    const styleElement = doc.createElement('style');
    styleElement.setAttribute('type', 'text/css');
    styleElement.setAttribute('data-ww-style-compiler-runtime', '');
    doc.head.appendChild(styleElement);

    const sheet = styleElement.sheet;
    if (!sheet) {
        styleElement.remove();
        return null;
    }

    const state = {
        sheet,
        runtimeLayer: null,
        groupLayers: new Map(),
        libraryLayers: new Map(),
        hasLibraryLayerOrder: false,
        mediaLayers: new Map(),
        styleRules: new Map(),
        failedRules: new Set(),
        clearGroupLayers: new Map(),
        clearLibraryLayers: new Map(),
        hasClearLibraryLayerOrder: false,
        clearMediaLayers: new Map(),
        clearStyleRules: new Map(),
        failedClearRules: new Set(),
    } satisfies RuntimeStyleSheetState;
    runtimeStyleSheetsByDocument.set(doc, state);
    return state;
}

function ensureRuntimeClearStyleRule(state: RuntimeStyleSheetState, variable: StyleDynamicVariable, selector: string) {
    const libraryLayer = getRuntimeLibraryLayer(variable);
    const breakpoint = STYLE_BREAKPOINTS.find(breakpoint => breakpoint.name === variable.breakpoint);
    const parent = breakpoint?.mediaQuery
        ? ensureRuntimeClearMediaLayer(state, variable.group, libraryLayer, breakpoint.mediaQuery)
        : ensureRuntimeClearVariableLayer(state, variable.group, libraryLayer);
    if (!parent) return null;

    const key = createRuntimeStyleRuleKey(variable.group, libraryLayer, breakpoint?.mediaQuery || '', selector);
    if (state.failedClearRules.has(key)) return null;

    const cachedRule = state.clearStyleRules.get(key);
    if (cachedRule) return cachedRule;

    try {
        const index = breakpoint?.mediaQuery
            ? parent.cssRules.length
            : getRuntimeBaseRuleInsertionIndex(parent, state.clearMediaLayers, variable.group, libraryLayer);
        parent.insertRule(`${selector} {}`, index);
        const rule = parent.cssRules[index] || null;
        if (!rule || !('style' in rule)) throw new Error(`Runtime clear rule was not created for ${selector}.`);

        const ruleState = {
            key,
            parent,
            rule: rule as CSSStyleRule,
            declarationsByProperty: new Map(),
        } satisfies RuntimeStyleRuleState;
        state.clearStyleRules.set(key, ruleState);
        return ruleState;
    } catch (error) {
        state.failedClearRules.add(key);
        wwLib.wwLog.warn('[style-compiler] failed to insert runtime CSS clear rule', { selector, error });
        return null;
    }
}

function ensureRuntimeClearMediaLayer(
    state: RuntimeStyleSheetState,
    group: StyleRuleGroup,
    libraryLayer: StyleLibraryLayer | undefined,
    mediaQuery: string
) {
    const key = createRuntimeMediaLayerKey(group, libraryLayer, mediaQuery);
    const cachedLayer = state.clearMediaLayers.get(key);
    if (cachedLayer) return cachedLayer;

    const groupLayer = ensureRuntimeClearVariableLayer(state, group, libraryLayer);
    if (!groupLayer) return null;

    try {
        const index = getRuntimeMediaLayerInsertionIndex(
            groupLayer,
            state.clearMediaLayers,
            group,
            libraryLayer,
            mediaQuery
        );
        groupLayer.insertRule(`@media ${formatMediaQuery(mediaQuery)} {}`, index);
        const rule = groupLayer.cssRules[index] || null;
        if (!isCssGroupingRule(rule)) throw new Error(`Runtime clear media layer was not created for ${mediaQuery}.`);

        state.clearMediaLayers.set(key, rule);
        return rule;
    } catch (error) {
        wwLib.wwLog.warn('[style-compiler] failed to insert runtime clear media layer', {
            group,
            mediaQuery,
            error,
        });
        return null;
    }
}

function ensureRuntimeClearVariableLayer(
    state: RuntimeStyleSheetState,
    group: StyleRuleGroup,
    libraryLayer: StyleLibraryLayer | undefined
) {
    if (group !== 'library') return ensureRuntimeClearGroupLayer(state, group);

    ensureRuntimeClearLibraryLayers(state);
    return state.clearLibraryLayers.get(libraryLayer || 'definition') || null;
}

function ensureRuntimeClearGroupLayer(state: RuntimeStyleSheetState, group: StyleRuleGroup) {
    const cachedLayer = state.clearGroupLayers.get(group);
    if (cachedLayer) return cachedLayer;

    try {
        const index = state.sheet.cssRules.length;
        state.sheet.insertRule(`@layer ${STYLE_RULE_GROUP_LAYERS[group]} {}`, index);
        const rule = state.sheet.cssRules[index] || null;
        if (!isCssGroupingRule(rule)) throw new Error(`Runtime clear ${group} layer was not created.`);

        state.clearGroupLayers.set(group, rule);
        return rule;
    } catch (error) {
        wwLib.wwLog.warn('[style-compiler] failed to insert runtime clear group layer', { group, error });
        return null;
    }
}

function ensureRuntimeClearLibraryLayers(state: RuntimeStyleSheetState) {
    const libraryGroupLayer = ensureRuntimeClearGroupLayer(state, 'library');
    if (!libraryGroupLayer) return;

    if (!state.hasClearLibraryLayerOrder) {
        try {
            const index = libraryGroupLayer.cssRules.length;
            libraryGroupLayer.insertRule(`@layer ${STYLE_LIBRARY_LAYER_ORDER.join(', ')};`, index);
            state.hasClearLibraryLayerOrder = true;
        } catch (error) {
            wwLib.wwLog.warn('[style-compiler] failed to insert runtime clear library layer order', { error });
        }
    }

    for (const libraryLayer of STYLE_LIBRARY_LAYER_ORDER) {
        if (state.clearLibraryLayers.has(libraryLayer)) continue;

        try {
            const index = libraryGroupLayer.cssRules.length;
            libraryGroupLayer.insertRule(`@layer ${libraryLayer} {}`, index);
            const rule = libraryGroupLayer.cssRules[index] || null;
            if (!isCssGroupingRule(rule)) {
                throw new Error(`Runtime clear library ${libraryLayer} layer was not created.`);
            }

            state.clearLibraryLayers.set(libraryLayer, rule);
        } catch (error) {
            wwLib.wwLog.warn('[style-compiler] failed to insert runtime clear library layer', {
                libraryLayer,
                error,
            });
        }
    }
}

function ensureRuntimeStyleRule(state: RuntimeStyleSheetState, variable: StyleDynamicVariable, selector: string) {
    const libraryLayer = getRuntimeLibraryLayer(variable);
    const breakpoint = STYLE_BREAKPOINTS.find(breakpoint => breakpoint.name === variable.breakpoint);
    const parent = breakpoint?.mediaQuery
        ? ensureRuntimeMediaLayer(state, variable.group, libraryLayer, breakpoint.mediaQuery)
        : ensureRuntimeVariableLayer(state, variable.group, libraryLayer);
    if (!parent) return null;

    const key = createRuntimeStyleRuleKey(variable.group, libraryLayer, breakpoint?.mediaQuery || '', selector);
    if (state.failedRules.has(key)) return null;

    const cachedRule = state.styleRules.get(key);
    if (cachedRule) return cachedRule;

    try {
        const index = breakpoint?.mediaQuery
            ? parent.cssRules.length
            : getRuntimeBaseRuleInsertionIndex(parent, state.mediaLayers, variable.group, libraryLayer);
        parent.insertRule(`${selector} {}`, index);
        const rule = parent.cssRules[index] || null;
        if (!rule || !('style' in rule)) throw new Error(`Runtime style rule was not created for ${selector}.`);

        const ruleState = {
            key,
            parent,
            rule: rule as CSSStyleRule,
            declarationsByProperty: new Map(),
        } satisfies RuntimeStyleRuleState;
        state.styleRules.set(key, ruleState);
        return ruleState;
    } catch (error) {
        state.failedRules.add(key);
        wwLib.wwLog.warn('[style-compiler] failed to insert runtime CSS variable rule', { selector, error });
        return null;
    }
}

function ensureRuntimeMediaLayer(
    state: RuntimeStyleSheetState,
    group: StyleRuleGroup,
    libraryLayer: StyleLibraryLayer | undefined,
    mediaQuery: string
) {
    const key = createRuntimeMediaLayerKey(group, libraryLayer, mediaQuery);
    const cachedLayer = state.mediaLayers.get(key);
    if (cachedLayer) return cachedLayer;

    const groupLayer = ensureRuntimeVariableLayer(state, group, libraryLayer);
    if (!groupLayer) return null;

    try {
        const index = getRuntimeMediaLayerInsertionIndex(
            groupLayer,
            state.mediaLayers,
            group,
            libraryLayer,
            mediaQuery
        );
        groupLayer.insertRule(`@media ${formatMediaQuery(mediaQuery)} {}`, index);
        const rule = groupLayer.cssRules[index] || null;
        if (!isCssGroupingRule(rule)) throw new Error(`Runtime media layer was not created for ${mediaQuery}.`);

        state.mediaLayers.set(key, rule);
        return rule;
    } catch (error) {
        wwLib.wwLog.warn('[style-compiler] failed to insert runtime media layer', { group, mediaQuery, error });
        return null;
    }
}

function ensureRuntimeVariableLayer(
    state: RuntimeStyleSheetState,
    group: StyleRuleGroup,
    libraryLayer: StyleLibraryLayer | undefined
) {
    if (group !== 'library') return ensureRuntimeGroupLayer(state, group);

    ensureRuntimeLibraryLayers(state);
    return state.libraryLayers.get(libraryLayer || 'definition') || null;
}

function getRuntimeBaseRuleInsertionIndex(
    parent: CSSGroupingRule,
    mediaLayers: Map<string, CSSGroupingRule>,
    group: StyleRuleGroup,
    libraryLayer: StyleLibraryLayer | undefined
) {
    let insertionIndex = parent.cssRules.length;

    for (const breakpoint of STYLE_BREAKPOINTS) {
        if (!breakpoint.mediaQuery) continue;

        const mediaLayer = mediaLayers.get(createRuntimeMediaLayerKey(group, libraryLayer, breakpoint.mediaQuery));
        if (!mediaLayer) continue;

        const mediaIndex = getCssRuleIndex(parent, mediaLayer);
        if (mediaIndex !== -1) insertionIndex = Math.min(insertionIndex, mediaIndex);
    }

    return insertionIndex;
}

function getRuntimeMediaLayerInsertionIndex(
    parent: CSSGroupingRule,
    mediaLayers: Map<string, CSSGroupingRule>,
    group: StyleRuleGroup,
    libraryLayer: StyleLibraryLayer | undefined,
    mediaQuery: string
) {
    const breakpointIndex = STYLE_BREAKPOINTS.findIndex(breakpoint => breakpoint.mediaQuery === mediaQuery);
    if (breakpointIndex === -1) return parent.cssRules.length;

    for (const breakpoint of STYLE_BREAKPOINTS.slice(breakpointIndex + 1)) {
        if (!breakpoint.mediaQuery) continue;

        const mediaLayer = mediaLayers.get(createRuntimeMediaLayerKey(group, libraryLayer, breakpoint.mediaQuery));
        if (!mediaLayer) continue;

        const mediaIndex = getCssRuleIndex(parent, mediaLayer);
        if (mediaIndex !== -1) return mediaIndex;
    }

    return parent.cssRules.length;
}

function createRuntimeMediaLayerKey(
    group: StyleRuleGroup,
    libraryLayer: StyleLibraryLayer | undefined,
    mediaQuery: string
) {
    return `${group}\u001f${libraryLayer || ''}\u001f${mediaQuery}`;
}

function ensureRuntimeGroupLayer(state: RuntimeStyleSheetState, group: StyleRuleGroup) {
    ensureRuntimeGroupLayers(state);
    return state.groupLayers.get(group) || null;
}

function ensureRuntimeGroupLayers(state: RuntimeStyleSheetState) {
    const runtimeLayer = ensureRuntimeLayer(state);
    if (!runtimeLayer) return;

    for (const group of STYLE_RULE_GROUPS) {
        if (state.groupLayers.has(group)) continue;

        try {
            const index = runtimeLayer.cssRules.length;
            runtimeLayer.insertRule(`@layer ${group} {}`, index);
            const rule = runtimeLayer.cssRules[index] || null;
            if (!isCssGroupingRule(rule)) throw new Error(`Runtime ${group} layer was not created.`);

            state.groupLayers.set(group, rule);
        } catch (error) {
            wwLib.wwLog.warn('[style-compiler] failed to insert runtime group layer', { group, error });
        }
    }
}

function ensureRuntimeLibraryLayers(state: RuntimeStyleSheetState) {
    const libraryGroupLayer = ensureRuntimeGroupLayer(state, 'library');
    if (!libraryGroupLayer) return;

    if (!state.hasLibraryLayerOrder) {
        try {
            const index = libraryGroupLayer.cssRules.length;
            libraryGroupLayer.insertRule(`@layer ${STYLE_LIBRARY_LAYER_ORDER.join(', ')};`, index);
            state.hasLibraryLayerOrder = true;
        } catch (error) {
            wwLib.wwLog.warn('[style-compiler] failed to insert runtime library layer order', { error });
        }
    }

    for (const libraryLayer of STYLE_LIBRARY_LAYER_ORDER) {
        if (state.libraryLayers.has(libraryLayer)) continue;

        try {
            const index = libraryGroupLayer.cssRules.length;
            libraryGroupLayer.insertRule(`@layer ${libraryLayer} {}`, index);
            const rule = libraryGroupLayer.cssRules[index] || null;
            if (!isCssGroupingRule(rule)) throw new Error(`Runtime library ${libraryLayer} layer was not created.`);

            state.libraryLayers.set(libraryLayer, rule);
        } catch (error) {
            wwLib.wwLog.warn('[style-compiler] failed to insert runtime library layer', { libraryLayer, error });
        }
    }
}

function ensureRuntimeLayer(state: RuntimeStyleSheetState) {
    if (state.runtimeLayer) return state.runtimeLayer;

    try {
        const index = state.sheet.cssRules.length;
        state.sheet.insertRule(`@layer ${STYLE_RUNTIME_LAYER} {}`, index);
        const rule = state.sheet.cssRules[index] || null;
        if (!isCssGroupingRule(rule)) throw new Error('Runtime CSS layer was not created.');

        state.runtimeLayer = rule;
        return rule;
    } catch (error) {
        wwLib.wwLog.warn('[style-compiler] failed to insert runtime CSS layer', { error });
        return null;
    }
}

function setRuntimeDeclaration(
    ruleState: RuntimeStyleRuleState,
    property: string,
    registrationKey: string,
    cssValue: string,
    priority: StyleDeclarationPriority = ''
) {
    let declarations = ruleState.declarationsByProperty.get(property);
    if (!declarations) {
        declarations = new Map();
        ruleState.declarationsByProperty.set(property, declarations);
    }

    declarations.set(registrationKey, { value: cssValue, priority });
    const declaration = getLastMapValue(declarations);
    ruleState.rule.style.setProperty(property, declaration.value, declaration.priority);
}

function removeRuntimeDeclaration(
    ruleStates: Map<string, RuntimeStyleRuleState>,
    ruleState: RuntimeStyleRuleState,
    property: string,
    registrationKey: string
) {
    const declarations = ruleState.declarationsByProperty.get(property);
    if (!declarations) return;

    declarations.delete(registrationKey);
    if (declarations.size) {
        const declaration = getLastMapValue(declarations);
        ruleState.rule.style.setProperty(property, declaration.value, declaration.priority);
        return;
    }

    ruleState.declarationsByProperty.delete(property);
    ruleState.rule.style.removeProperty(property);
    if (hasRuntimeDeclarations(ruleState)) return;

    deleteRuntimeStyleRule(ruleState);
    ruleStates.delete(ruleState.key);
}

function deleteRuntimeStyleRule(ruleState: RuntimeStyleRuleState) {
    deleteCssRule(ruleState.parent, ruleState.rule);
}

function deleteCssRule(parent: CSSStyleSheet | CSSGroupingRule, rule: CSSRule) {
    const index = getCssRuleIndex(parent, rule);
    if (index !== -1) parent.deleteRule(index);
}

function getCssRuleIndex(parent: CSSStyleSheet | CSSGroupingRule, rule: CSSRule) {
    return Array.prototype.indexOf.call(parent.cssRules, rule);
}

function hasRuntimeDeclarations(ruleState: RuntimeStyleRuleState) {
    for (const declarations of ruleState.declarationsByProperty.values()) {
        if (declarations.size) return true;
    }

    return false;
}

function createRuntimeVariableSelector(variable: StyleDynamicVariable, componentId: string) {
    const componentSelector = `[${WW_COMPONENT_ID_ATTRIBUTE}="${escapeCssString(componentId)}"]`;
    const scopeSelector = variable.surface.runtimeScopeSelector || variable.surface.selector;
    const scopeSelectorParts = splitCssSelectorList(scopeSelector).sort((a, b) => b.length - a.length);

    return splitCssSelectorList(variable.selector)
        .map(selectorPart => replaceRuntimeScopeSelector(selectorPart, scopeSelectorParts, componentSelector))
        .join(',\n');
}

function replaceRuntimeScopeSelector(
    selectorPart: string,
    scopeSelectorParts: readonly string[],
    componentSelector: string
) {
    for (const scopeSelectorPart of scopeSelectorParts) {
        if (!selectorPart.includes(scopeSelectorPart)) continue;

        return selectorPart.split(scopeSelectorPart).join(componentSelector);
    }

    return `${componentSelector} ${selectorPart}`;
}

function createRuntimeStyleRuleKey(
    group: StyleRuleGroup,
    libraryLayer: StyleLibraryLayer | undefined,
    mediaQuery: string,
    selector: string
) {
    return [group, libraryLayer || '', mediaQuery, selector].join('\u001f');
}

function getRuntimeLibraryLayer(variable: StyleDynamicVariable) {
    if (variable.group !== 'library') return undefined;

    return variable.surface.libraryLayer || 'definition';
}

export function createStyleCompilerRuntimeVariableRegistrationKey(componentId: string, variable: StyleDynamicVariable) {
    return [
        componentId,
        variable.group,
        variable.surface.libraryLayer || '',
        variable.sourceUid,
        variable.surface.key,
        variable.selector,
        variable.name,
        variable.kind || '',
        variable.keyframesName || '',
        variable.outputKey || '',
        stringifyDynamicVariableValueNormalizer(variable.valueNormalizer),
        variable.cssProperty,
        variable.validationProperty,
        variable.directDeclaration ? 'direct' : '',
        variable.domain,
        variable.property,
        variable.state,
        variable.breakpoint,
    ].join('\u001f');
}

function normalizeKeyframesNamePart(value: string) {
    return value.replace(/[^a-zA-Z0-9_-]/g, '-');
}

function stringifyDynamicVariableValueNormalizer(valueNormalizer: StyleDynamicVariable['valueNormalizer']) {
    if (!valueNormalizer) return '';

    return JSON.stringify(valueNormalizer);
}

function getLastMapValue(map: ReadonlyMap<string, RuntimeStyleDeclaration>) {
    let lastValue: RuntimeStyleDeclaration = { value: '', priority: '' };

    for (const value of map.values()) {
        lastValue = value;
    }

    return lastValue;
}

function isCssGroupingRule(rule: CSSRule | null): rule is CSSGroupingRule {
    return !!rule && 'cssRules' in rule && 'insertRule' in rule && 'deleteRule' in rule;
}
