import { escapeCssString } from './serialization';
import { resolveParentSelector, splitCssSelectorList } from './selectors';
import type {
    StyleConfiguredState,
    StyleCompilerMode,
    StyleDiagnostic,
    StyleElementReader,
    StyleSectionReader,
    StyleStateDescriptor,
    StyleSurface,
} from './types';

/**
 * WeWeb state names that can be represented as native CSS pseudo selectors.
 *
 * These do not require runtime state attributes for static/runtime CSS. Editor preview adds
 * `data-ww-forced-states` fallbacks so the side panel can preview native states without forcing
 * actual browser hover/focus/active.
 */
const NATIVE_STYLE_STATE_PSEUDO_CLASSES: Record<string, string> = {
    _wwHover: ':hover',
    _wwFocus: ':focus-within',
    _wwFocusVisible: ':focus-visible',
    _wwActive: ':active',
};

const EDITOR_PREVIEW_SELECTOR = ':where(#app.-ww-preview)';
const EDITOR_PREVIEW_ONLY_PSEUDO_CLASS_RE = /:(?:hover|active|focus(?:-visible|-within)?)(?![\w-])/;

export const PARENT_STYLE_STATE_PREFIX = '_wwParent_';

/**
 * Normalizes component configuration state declarations.
 *
 * Strings keep the old `states: ['focus']` API. Objects add selector metadata while still matching
 * persisted state data by label, because existing saved states may have generated ids.
 */
export function normalizeConfiguredStyleStates(states: readonly StyleConfiguredState[] | null | undefined) {
    const normalizedStates: Array<{ label: string; selectors?: readonly string[] }> = [];
    const seenLabels = new Set<string>();

    for (const state of states || []) {
        const normalizedState = normalizeConfiguredStyleState(state);
        if (!normalizedState || seenLabels.has(normalizedState.label)) continue;

        normalizedStates.push(normalizedState);
        seenLabels.add(normalizedState.label);
    }

    return normalizedStates;
}

function normalizeConfiguredStyleState(state: StyleConfiguredState) {
    if (typeof state === 'string') return state ? { label: state } : null;
    if (!state || typeof state !== 'object' || Array.isArray(state) || typeof state.label !== 'string') return null;

    const selectors = [state.selector, ...(Array.isArray(state.selectors) ? state.selectors : [])].filter(
        (selector): selector is string => typeof selector === 'string' && selector.includes('&')
    );

    return selectors.length ? { label: state.label, selectors } : { label: state.label };
}

/**
 * Removes duplicate/empty states and excludes the internal base state.
 */
export function getUniqueStates(states: readonly StyleStateDescriptor[]) {
    const normalizedStates: StyleStateDescriptor[] = [];
    const seenStateIds = new Set<string>();

    for (const state of states) {
        if (!state.id || state.id === 'base' || seenStateIds.has(state.id)) continue;

        normalizedStates.push(state);
        seenStateIds.add(state.id);
    }

    return normalizedStates;
}

/**
 * Returns the CSS selector for a state rule, plus diagnostics when a state cannot be represented.
 */
export function getStateRuleSelectors({
    state,
    surface,
    source,
    mode,
}: {
    state: StyleStateDescriptor;
    surface: StyleSurface;
    source: StyleElementReader | StyleSectionReader;
    mode?: StyleCompilerMode;
}): {
    selector?: string;
    diagnostics: StyleDiagnostic[];
} {
    const parentState = state.parent;
    const includeForcedStateSelectors = mode === 'editor';
    const selectors: string[] = [];

    if (parentState) {
        const parentSelector = parentState.selector || resolveParentSelector(parentState.uid, source);
        if (parentSelector) {
            const nativePseudoClass = getNativeStyleStatePseudoClass(parentState.stateId);
            if (!nativePseudoClass) {
                selectors.push(
                    prependParentStateAttribute(surface.selector, parentSelector, 'data-ww-states', parentState.stateId)
                );
            }

            if (parentState.selectors?.length) {
                selectors.push(
                    ...parentState.selectors.flatMap(selector =>
                        splitCssSelectorList(selector).map(selectorPart => {
                            const configuredParentSelector = mapSelectorList(parentSelector, parentSelectorPart =>
                                selectorPart.replaceAll('&', parentSelectorPart)
                            );
                            const ruleSelector = prependParentSelector(surface.selector, configuredParentSelector);
                            return gatePreviewOnlySelectorInEditor(ruleSelector, selectorPart, mode);
                        })
                    )
                );
            }

            if (nativePseudoClass) {
                selectors.push(
                    gateSelectorInEditorPreview(
                        prependParentPseudoClass(surface.selector, parentSelector, nativePseudoClass),
                        mode
                    )
                );
            }

            if (includeForcedStateSelectors) {
                selectors.push(
                    prependParentStateAttribute(
                        surface.selector,
                        parentSelector,
                        'data-ww-forced-states',
                        parentState.stateId
                    )
                );
            }
        }
    } else {
        const nativePseudoClass = getNativeStyleStatePseudoClass(state.id);
        if (!nativePseudoClass) {
            // Persisted states can also be activated by a formula at runtime.
            selectors.push(appendStateAttribute(surface.selector, state.id));
        }

        if (state.selectors?.length) {
            selectors.push(
                ...state.selectors.flatMap(selector =>
                    splitCssSelectorList(selector).map(selectorPart =>
                        gatePreviewOnlySelectorInEditor(
                            mapSelectorList(surface.selector, surfaceSelectorPart =>
                                applyConfiguredStateSelector(surfaceSelectorPart, selectorPart)
                            ),
                            selectorPart,
                            mode
                        )
                    )
                )
            );
        }

        if (nativePseudoClass) {
            selectors.push(gateSelectorInEditorPreview(appendPseudoClass(surface.selector, nativePseudoClass), mode));
        }
    }

    if (selectors.length && !parentState && includeForcedStateSelectors) {
        selectors.push(appendForcedStateAttribute(surface.selector, state.id));
    }

    if (selectors.length) return { selector: joinSelectors(selectors), diagnostics: [] };

    return {
        diagnostics: [
            {
                code: 'state-selector-unresolved',
                surface,
                selector: surface.selector,
                message: `Could not resolve CSS selector for state ${state.id}.`,
            },
        ],
    };
}

/**
 * Returns the native pseudo class for a known WeWeb state name.
 */
export function getNativeStyleStatePseudoClass(state: string) {
    return NATIVE_STYLE_STATE_PSEUDO_CLASSES[state] || null;
}

/**
 * Transient browser interaction states must only react to the rendered DOM in editor Preview mode.
 * `:where()` keeps the mode marker from increasing the generated selector specificity.
 */
function gateSelectorInEditorPreview(selector: string, mode?: StyleCompilerMode) {
    if (mode !== 'editor') return selector;
    return mapSelectorList(selector, selectorPart => `${EDITOR_PREVIEW_SELECTOR} ${selectorPart}`);
}

/**
 * Configured selectors can contain arbitrary structural states such as `:disabled` or `[aria-selected]`.
 * Only the known pointer/focus pseudo-classes are transient editor interactions. Matching the configured
 * selector also handles nested forms such as `&:has(input:focus)` without component-specific metadata.
 */
function gatePreviewOnlySelectorInEditor(selector: string, configuredSelector: string, mode?: StyleCompilerMode) {
    return EDITOR_PREVIEW_ONLY_PSEUDO_CLASS_RE.test(configuredSelector)
        ? gateSelectorInEditorPreview(selector, mode)
        : selector;
}

/**
 * Appends a native pseudo class to a surface selector.
 */
function appendPseudoClass(selector: string, pseudoClass: string) {
    return mapSelectorList(selector, selectorPart => `${selectorPart}:where(${pseudoClass})`);
}

/**
 * Creates a parent-state selector such as `.parent:hover .child`.
 */
function prependParentPseudoClass(selector: string, parentSelector: string, pseudoClass: string) {
    return combineParentAndChildSelectors(
        selector,
        parentSelector,
        parentSelectorPart => `:where(${parentSelectorPart}${pseudoClass})`
    );
}

/**
 * Creates a parent-state selector such as `.parent:focus-within .child`.
 */
function prependParentSelector(selector: string, parentSelector: string) {
    return combineParentAndChildSelectors(
        selector,
        parentSelector,
        parentSelectorPart => `:where(${parentSelectorPart})`
    );
}

/**
 * Creates a parent state attribute selector such as `.parent[data-ww-forced-states~="focus"] .child`.
 */
function prependParentStateAttribute(
    selector: string,
    parentSelector: string,
    attribute: 'data-ww-states' | 'data-ww-forced-states',
    state: string
) {
    const attributeSelector = createStateAttributeSelector(attribute, state);
    return combineParentAndChildSelectors(
        selector,
        parentSelector,
        parentSelectorPart => `:where(${parentSelectorPart}${attributeSelector})`
    );
}

/**
 * Appends the runtime state attribute selector for custom runtime states.
 */
function appendStateAttribute(selector: string, state: string) {
    const attributeSelector = createStateAttributeSelector('data-ww-states', state);
    return mapSelectorList(selector, selectorPart => `${selectorPart}:where(${attributeSelector})`);
}

/**
 * Appends the editor-only forced-state attribute selector.
 */
function appendForcedStateAttribute(selector: string, state: string) {
    const attributeSelector = createStateAttributeSelector('data-ww-forced-states', state);
    return mapSelectorList(selector, selectorPart => `${selectorPart}:where(${attributeSelector})`);
}

/**
 * Applies a component-configured selector without increasing the rendered surface specificity.
 *
 * Configured selectors normally append a condition to `&`, such as `&:focus-within`. The fallback
 * keeps ancestor forms such as `.form &` working while still neutralizing their extra specificity.
 */
function applyConfiguredStateSelector(surfaceSelector: string, configuredSelector: string) {
    const firstAmpersand = configuredSelector.indexOf('&');
    const hasOneLeadingAmpersand = firstAmpersand === 0 && configuredSelector.indexOf('&', 1) === -1;
    const targetsSurface = configuredSelectorTargetsSurface(configuredSelector);
    if (hasOneLeadingAmpersand && targetsSurface) {
        const condition = configuredSelector.slice(1);
        return condition ? `${surfaceSelector}:where(${condition})` : surfaceSelector;
    }

    const replacedSelector = configuredSelector.replaceAll('&', surfaceSelector);
    if (!targetsSurface) return replacedSelector;

    return `${surfaceSelector}:where(${replacedSelector})`;
}

/**
 * Returns whether the configured selector still targets the surface represented by its last `&`.
 *
 * A top-level combinator or pseudo-element after the last `&` changes the target. Those selectors
 * must keep their legacy replacement form because nesting them in `:where()` would be invalid or
 * would apply declarations to a different element.
 */
function configuredSelectorTargetsSurface(configuredSelector: string) {
    const lastAmpersand = configuredSelector.lastIndexOf('&');
    if (lastAmpersand === -1) return false;

    const suffix = configuredSelector.slice(lastAmpersand + 1);
    let parenthesisDepth = 0;
    let bracketDepth = 0;
    let quote: '"' | "'" | null = null;
    let escaped = false;

    for (let index = 0; index < suffix.length; index += 1) {
        const character = suffix[index];
        if (escaped) {
            escaped = false;
            continue;
        }
        if (character === '\\') {
            escaped = true;
            continue;
        }
        if (quote) {
            if (character === quote) quote = null;
            continue;
        }
        if (character === '"' || character === "'") {
            quote = character;
            continue;
        }
        if (character === '(') {
            parenthesisDepth += 1;
            continue;
        }
        if (character === ')') {
            parenthesisDepth = Math.max(0, parenthesisDepth - 1);
            continue;
        }
        if (character === '[') {
            bracketDepth += 1;
            continue;
        }
        if (character === ']') {
            bracketDepth = Math.max(0, bracketDepth - 1);
            continue;
        }
        if (parenthesisDepth || bracketDepth) continue;

        if (/\s/.test(character) || character === '>' || character === '+' || character === '~') return false;
        if (character === '|' && suffix[index + 1] === '|') return false;
        if (character === ':' && suffix[index + 1] === ':') return false;
    }

    return true;
}

function createStateAttributeSelector(attribute: 'data-ww-states' | 'data-ww-forced-states', state: string) {
    return `[${attribute}~="${escapeCssString(state)}"]`;
}

/**
 * Joins selectors while removing duplicates from fallback/native combinations.
 */
function joinSelectors(selectors: string[]) {
    return [...new Set(selectors)].join(',\n');
}

function mapSelectorList(selector: string, callback: (selectorPart: string) => string) {
    return splitCssSelectorList(selector).map(callback).join(',\n');
}

function combineParentAndChildSelectors(
    selector: string,
    parentSelector: string,
    mapParentSelector: (parentSelectorPart: string) => string = parentSelectorPart => parentSelectorPart
) {
    const selectors: string[] = [];

    for (const parentSelectorPart of splitCssSelectorList(parentSelector)) {
        for (const selectorPart of splitCssSelectorList(selector)) {
            selectors.push(`${mapParentSelector(parentSelectorPart)} ${selectorPart}`);
        }
    }

    return selectors.join(',\n');
}
