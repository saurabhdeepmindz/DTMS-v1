import { getFormulaStaticValue } from '../formulaExecutor';
import { STYLE_BREAKPOINTS } from './breakpoints';
import { serializeRuntimeCssVariableValue, splitLegacyCssPriority } from './cssValue';
import type { StyleBreakpointName } from './breakpoints';
import type {
    CssStyleRecord,
    StyleClassReader,
    StyleCompilerInput,
    StyleDynamicVariableBase,
    StyleDynamicVariableReference,
    StyleElementReader,
    StyleCssValueMap,
    StyleCssValueNormalizer,
    StylePropertyDomain,
    StyleBreakpointPropertyReader,
    StylePropertyTreeReader,
    StyleSectionReader,
    StyleStateReader,
    StyleStringifiedDynamicVariableReference,
    StyleSurface,
} from './types';
import { STYLE_DYNAMIC_VARIABLE_REFERENCE } from './types';
import { mapStyleValue } from './valueNormalization';

type RawStyleSlotValue = {
    value: unknown;
    originBreakpoint?: StyleBreakpointName;
    source: StyleElementReader | StyleSectionReader;
};

type CustomCssMap = Record<string, unknown>;

type CustomCssResolution = {
    map: CustomCssMap | undefined;
    originBreakpoint?: StyleBreakpointName;
    hasStateOverride: boolean;
};

export type StylePropertyOrigin = {
    kind: 'class' | 'subclass' | 'source';
    precedence: number;
};

type RawStylePropertyResolution = {
    value: unknown;
    origin: StylePropertyOrigin;
};

type RawStylePropertyCandidate = {
    kind: StylePropertyOrigin['kind'];
    reader: StyleBreakpointPropertyReader;
};

const stringifiedDynamicReferenceStack: StyleStringifiedDynamicVariableReference[][] = [];
const NO_DYNAMIC_FALLBACK = Symbol('weweb.styleCompiler.noDynamicFallback');

/**
 * Shared data for one source/state/breakpoint slot.
 *
 * Declaration resolvers resolve many properties inside the same slot; this avoids rereading the
 * same state readers and class ids for every property.
 */
export type StyleSlotContext = {
    baseState: StyleStateReader;
    baseClassIds: string[];
    stateReader: StyleStateReader;
    stateClassIds: string[];
};

/**
 * Builds reusable context for one source/state/breakpoint slot.
 */
export function createStyleSlotContext({
    source,
    state,
    domain = 'style',
}: {
    source: StyleElementReader | StyleSectionReader;
    state: string;
    domain?: StylePropertyDomain;
}): StyleSlotContext {
    const propertyTree = getSourcePropertyTree(source, domain);
    const baseState = propertyTree.state('base');
    const stateReader = state === 'base' ? baseState : propertyTree.state(state);

    return {
        baseState,
        baseClassIds: getStringArray(baseState.classIds()),
        stateReader,
        stateClassIds: stateReader !== baseState ? getStringArray(stateReader.classIds()) : [],
    };
}

/**
 * Resolves a normal style property for the exact state+breakpoint slot.
 *
 * CSS handles base-state and breakpoint cascade through rule insertion order inside a target chunk
 * and media queries, so the common property path only resolves class/subclass/source precedence for
 * this slot.
 */
export function resolveStyleProperty({
    input,
    surface,
    source,
    property,
    state,
    breakpoint,
    slot,
    domain = 'style',
    valueNormalizer,
}: {
    input: StyleCompilerInput;
    surface: StyleSurface;
    source: StyleElementReader | StyleSectionReader;
    property: string;
    state: string;
    breakpoint: StyleBreakpointName;
    slot?: StyleSlotContext;
    domain?: StylePropertyDomain;
    valueNormalizer?: StyleCssValueNormalizer;
}): unknown {
    const rawValue = resolveRawStyleProperty({
        input,
        source,
        property,
        state,
        breakpoint,
        slot,
        domain,
    });

    if (rawValue === undefined) return undefined;
    if (!isDynamicStylePropertyValue(rawValue, valueNormalizer)) return rawValue;

    return createDynamicCssVariableReference({
        input,
        surface,
        sourceUid: source.uid(),
        property,
        state,
        breakpoint,
        domain,
        valueNormalizer,
        omitWhenUndefined: source.capabilities?.().omitUndefinedDynamicValues,
        value: rawValue,
    });
}

function isDynamicStylePropertyValue(value: unknown, valueNormalizer?: StyleCssValueNormalizer) {
    if (isDynamicValue(value)) return true;

    return (
        valueNormalizer?.type === 'space-separated-list' &&
        Array.isArray(value) &&
        value.some(item => isDynamicValue(item))
    );
}

/**
 * Returns the cascade origin of a property in the current state and breakpoint slot.
 *
 * Declaration families such as typography need this to distinguish stale longhands stored next
 * to a class shorthand from deliberate source or later-class overrides.
 */
export function resolveStylePropertyOrigin({
    input,
    source,
    property,
    state,
    breakpoint,
    slot,
    domain = 'style',
}: {
    input: StyleCompilerInput;
    source: StyleElementReader | StyleSectionReader;
    property: string;
    state: string;
    breakpoint: StyleBreakpointName;
    slot?: StyleSlotContext;
    domain?: StylePropertyDomain;
}): StylePropertyOrigin | undefined {
    return resolveRawStylePropertyWithOrigin({
        input,
        source,
        property,
        state,
        breakpoint,
        slot,
        domain,
    })?.origin;
}

/**
 * Resolves and maps a property for component-configured CSS outputs.
 *
 * Static values are mapped immediately. Formula values keep the source formula payload and carry the
 * value map to runtime variable writers, using `outputKey` to create a distinct CSS variable for each
 * derived declaration.
 */
export function resolveMappedStyleProperty({
    input,
    surface,
    source,
    property,
    outputKey,
    valueMap,
    state,
    breakpoint,
    slot,
    domain = 'style',
}: {
    input: StyleCompilerInput;
    surface: StyleSurface;
    source: StyleElementReader | StyleSectionReader;
    property: string;
    outputKey: string;
    valueMap: StyleCssValueMap;
    state: string;
    breakpoint: StyleBreakpointName;
    slot?: StyleSlotContext;
    domain?: StylePropertyDomain;
}): unknown {
    const rawValue = resolveRawStyleProperty({
        input,
        source,
        property,
        state,
        breakpoint,
        slot,
        domain,
    });

    if (rawValue === undefined) return undefined;
    if (!isDynamicValue(rawValue)) return mapStyleValue(rawValue, valueMap);

    return createDynamicCssVariableReference({
        input,
        surface,
        sourceUid: source.uid(),
        property,
        outputKey,
        valueNormalizer: {
            type: 'map',
            map: valueMap,
        },
        omitWhenUndefined: source.capabilities?.().omitUndefinedDynamicValues,
        state,
        breakpoint,
        domain,
        value: rawValue,
    });
}

/**
 * Resolves one custom CSS property for the exact state+breakpoint slot.
 *
 * Custom CSS is resolved per CSS property name because the object can be merged from classes,
 * subclasses, states, and breakpoints just like normal style properties.
 */
export function resolveCustomCssProperty({
    input,
    surface,
    source,
    property,
    state,
    breakpoint,
    slot,
}: {
    input: StyleCompilerInput;
    surface: StyleSurface;
    source: StyleElementReader | StyleSectionReader;
    property: string;
    state: string;
    breakpoint: StyleBreakpointName;
    slot?: StyleSlotContext;
}): unknown {
    const sourceProperty = `customCss.${property}`;
    const rawValue = resolveRawCustomCssProperty({
        input,
        source,
        property,
        state,
        breakpoint,
        slot,
    });

    if (rawValue === undefined) return undefined;
    if (!isDynamicValue(rawValue)) return rawValue;

    return createDynamicCssVariableReference({
        input,
        surface,
        sourceUid: source.uid(),
        property: sourceProperty,
        state,
        breakpoint,
        domain: 'style',
        omitWhenUndefined: source.capabilities?.().omitUndefinedDynamicValues,
        value: rawValue,
    });
}

/**
 * Resolves Custom CSS with the legacy whole-object semantics.
 *
 * Unlike normal style properties, Custom CSS was one responsive/stateful property whose object was
 * replaced wholesale whenever a more specific slot stored a value. The compiler emits the final
 * map for each mutually-exclusive breakpoint, and state rules explicitly clear keys removed by a
 * state override.
 */
export function resolveCustomCssProperties({
    input,
    surface,
    source,
    state,
    breakpoint,
    slot,
}: {
    input: StyleCompilerInput;
    surface: StyleSurface;
    source: StyleElementReader | StyleSectionReader;
    state: string;
    breakpoint: StyleBreakpointName;
    slot?: StyleSlotContext;
}): { properties: Array<{ property: string; value: unknown }>; useBreakpointRange: boolean } {
    const styleTree = source.style();
    const baseState = slot?.baseState || styleTree.state('base');
    const baseClassIds = slot?.baseClassIds || getStringArray(baseState.classIds());
    const baseResolution = resolveEffectiveCustomCssMap({
        input,
        baseState,
        baseClassIds,
        breakpoint,
    });
    const baseMap = baseResolution.map;

    if (state === 'base') {
        const useBreakpointRange = usesResponsiveCustomCssMap({
            input,
            baseState,
            baseClassIds,
            currentBreakpoint: breakpoint,
            currentResolution: baseResolution,
        });
        return {
            properties:
                useBreakpointRange || breakpoint === 'default'
                    ? createResolvedCustomCssProperties({
                          input,
                          surface,
                          source,
                          state,
                          breakpoint: baseResolution.originBreakpoint || breakpoint,
                          map: baseMap,
                      })
                    : [],
            useBreakpointRange,
        };
    }

    const stateReader = slot?.stateReader || styleTree.state(state);
    const stateClassIds = slot?.stateClassIds || getStringArray(stateReader.classIds());
    const stateResolution = resolveEffectiveCustomCssMap({
        input,
        baseState,
        baseClassIds,
        stateReader,
        stateClassIds,
        breakpoint,
    });

    const useBreakpointRange = usesResponsiveCustomCssMap({
        input,
        baseState,
        baseClassIds,
        stateReader,
        stateClassIds,
        currentBreakpoint: breakpoint,
        currentResolution: stateResolution,
    });

    if (!stateResolution.hasStateOverride || (!useBreakpointRange && breakpoint !== 'default')) {
        return { properties: [], useBreakpointRange };
    }

    const stateMap = stateResolution.map || {};

    const properties = new Set([...Object.keys(baseMap || {}), ...Object.keys(stateMap)]);
    const result: Array<{ property: string; value: unknown }> = [];

    for (const property of properties) {
        const baseValue = baseMap?.[property];
        const hasStateValue = Object.hasOwn(stateMap, property) && stateMap[property] != null;

        if (!hasStateValue) {
            if (baseValue == null) continue;
            result.push({
                property,
                value: getCustomCssResetValue(property, baseValue),
            });
            continue;
        }

        const stateValue = resolveCustomCssValue({
            input,
            surface,
            source,
            property,
            state,
            breakpoint: stateResolution.originBreakpoint || breakpoint,
            value: stateMap[property],
        });
        result.push({ property, value: preserveOverriddenImportantPriority(property, stateValue, baseValue) });
    }

    return { properties: result, useBreakpointRange };
}

function createResolvedCustomCssProperties({
    input,
    surface,
    source,
    state,
    breakpoint,
    map,
}: {
    input: StyleCompilerInput;
    surface: StyleSurface;
    source: StyleElementReader | StyleSectionReader;
    state: string;
    breakpoint: StyleBreakpointName;
    map: CustomCssMap | undefined;
}) {
    if (!map) return [];

    const result: Array<{ property: string; value: unknown }> = [];
    for (const [property, value] of Object.entries(map)) {
        if (!property || value == null) continue;
        result.push({
            property,
            value: resolveCustomCssValue({
                input,
                surface,
                source,
                property,
                state,
                breakpoint,
                value,
            }),
        });
    }
    return result;
}

function resolveCustomCssValue({
    input,
    surface,
    source,
    property,
    state,
    breakpoint,
    value,
}: {
    input: StyleCompilerInput;
    surface: StyleSurface;
    source: StyleElementReader | StyleSectionReader;
    property: string;
    state: string;
    breakpoint: StyleBreakpointName;
    value: unknown;
}) {
    if (!isDynamicValue(value)) return value;

    return createDynamicCssVariableReference({
        input,
        surface,
        sourceUid: source.uid(),
        property: `customCss.${property}`,
        state,
        breakpoint,
        domain: 'style',
        omitWhenUndefined: source.capabilities?.().omitUndefinedDynamicValues,
        value,
    });
}

/**
 * Replays the legacy whole-value resolution order for Custom CSS.
 *
 * The old runtime resolved `customCss` through `getComponentRawProperty`, then iterated the final
 * object. A defined object therefore replaces the previous object instead of merging its keys.
 */
function resolveEffectiveCustomCssMap({
    input,
    baseState,
    baseClassIds,
    stateReader,
    stateClassIds = [],
    breakpoint,
}: {
    input: StyleCompilerInput;
    baseState: StyleStateReader;
    baseClassIds: string[];
    stateReader?: StyleStateReader;
    stateClassIds?: string[];
    breakpoint: StyleBreakpointName;
}): CustomCssResolution {
    let map: CustomCssMap | undefined;
    let originBreakpoint: StyleBreakpointName | undefined;
    let hasStateOverride = false;

    const applyMap = (replacement: CustomCssMap | undefined, candidateBreakpoint: StyleBreakpointName) => {
        if (replacement === undefined) return;

        map = replacement;
        originBreakpoint = candidateBreakpoint;
    };

    for (const inheritedBreakpoint of getInheritedBreakpointNames(breakpoint)) {
        for (const classId of baseClassIds) {
            const classReader = input.reader.styleClass?.(classId);
            applyMap(readClassCustomCssMap(classReader, inheritedBreakpoint), inheritedBreakpoint);

            for (const subClassId of getStringArray(baseState.subClassIds(classId))) {
                applyMap(
                    readClassCustomCssMap(classReader?.subClass(subClassId), inheritedBreakpoint),
                    inheritedBreakpoint
                );
            }

            if (stateReader) {
                for (const subClassId of getStringArray(stateReader.subClassIds(classId))) {
                    const stateSubClassMap = readClassCustomCssMap(
                        classReader?.subClass(subClassId),
                        inheritedBreakpoint
                    );
                    if (stateSubClassMap !== undefined) {
                        applyMap(stateSubClassMap, inheritedBreakpoint);
                        hasStateOverride = true;
                    }
                }
            }
        }

        applyMap(readCustomCssMap(baseState.breakpoint(inheritedBreakpoint)), inheritedBreakpoint);
    }

    if (!stateReader) return { map, originBreakpoint, hasStateOverride };

    for (const inheritedBreakpoint of getInheritedBreakpointNames(breakpoint)) {
        for (const classId of stateClassIds) {
            const classReader = input.reader.styleClass?.(classId);
            const classMap = readClassCustomCssMap(classReader, inheritedBreakpoint);
            if (classMap !== undefined) {
                applyMap(classMap, inheritedBreakpoint);
                hasStateOverride = true;
            }

            for (const subClassId of getStringArray(stateReader.subClassIds(classId))) {
                const subClassMap = readClassCustomCssMap(classReader?.subClass(subClassId), inheritedBreakpoint);
                if (subClassMap !== undefined) {
                    applyMap(subClassMap, inheritedBreakpoint);
                    hasStateOverride = true;
                }
            }
        }

        const sourceMap = readCustomCssMap(stateReader.breakpoint(inheritedBreakpoint));
        if (sourceMap !== undefined) {
            applyMap(sourceMap, inheritedBreakpoint);
            hasStateOverride = true;
        }
    }

    return { map, originBreakpoint, hasStateOverride };
}

function usesResponsiveCustomCssMap({
    input,
    baseState,
    baseClassIds,
    stateReader,
    stateClassIds,
    currentBreakpoint,
    currentResolution,
}: {
    input: StyleCompilerInput;
    baseState: StyleStateReader;
    baseClassIds: string[];
    stateReader?: StyleStateReader;
    stateClassIds?: string[];
    currentBreakpoint: StyleBreakpointName;
    currentResolution: CustomCssResolution;
}) {
    for (const breakpoint of ['tablet', 'mobile'] as const) {
        const resolution =
            breakpoint === currentBreakpoint
                ? currentResolution
                : resolveEffectiveCustomCssMap({
                      input,
                      baseState,
                      baseClassIds,
                      stateReader,
                      stateClassIds,
                      breakpoint,
                  });
        if (resolution.originBreakpoint === breakpoint) return true;
    }

    return false;
}

function readClassCustomCssMap(classReader: StyleClassReader | null | undefined, breakpoint: StyleBreakpointName) {
    if (!classReader) return undefined;

    return readCustomCssMap(classReader.style().state('base').breakpoint(breakpoint));
}

function readCustomCssMap(reader: StyleBreakpointPropertyReader): CustomCssMap | undefined {
    const value = reader.customCss();
    if (value === undefined) return undefined;
    if (!value || typeof value !== 'object' || Array.isArray(value) || isDynamicValue(value)) return {};

    return value as CustomCssMap;
}

function getCustomCssResetValue(property: string, baseValue: unknown) {
    return hasImportantPriority(property, baseValue) ? 'revert-layer !important' : 'revert-layer';
}

/**
 * A state rule and its base rule coexist in CSS, unlike the single legacy inline declaration.
 * Preserve an inherited important priority so a more specific state value can still replace it.
 */
function preserveOverriddenImportantPriority(property: string, stateValue: unknown, baseValue: unknown) {
    if (!hasImportantPriority(property, baseValue) || hasImportantPriority(property, stateValue)) return stateValue;

    const cssValue = serializeRuntimeCssVariableValue(property, stateValue);
    return cssValue === undefined ? stateValue : `${cssValue} !important`;
}

function hasImportantPriority(property: string, value: unknown) {
    const cssValue = serializeRuntimeCssVariableValue(property, value);
    return cssValue ? splitLegacyCssPriority(property, cssValue).priority === 'important' : false;
}

/**
 * Resolves a normal property through breakpoint/base-state inheritance.
 *
 * This is intentionally not the default path. It exists for composite CSS declarations, like
 * ordered background layers, where one serialized CSS declaration may need inherited source pieces
 * to stay layer-aligned.
 */
type ResolveEffectiveStylePropertyInput = {
    input: StyleCompilerInput;
    surface: StyleSurface;
    source: StyleElementReader | StyleSectionReader;
    property: string;
    state: string;
    breakpoint: StyleBreakpointName;
    slot?: StyleSlotContext;
    domain?: StylePropertyDomain;
    valueNormalizer?: StyleCssValueNormalizer;
    validationProperty?: string;
    includeSourceFallback?: boolean;
};

export type EffectiveStylePropertyResolution = {
    value: unknown;
    source: StyleElementReader | StyleSectionReader;
};

export function resolveEffectiveStyleProperty(input: ResolveEffectiveStylePropertyInput): unknown {
    return resolveEffectiveStylePropertyWithSource(input)?.value;
}

/**
 * Resolves an effective property together with the source that owns its runtime context.
 *
 * Most declarations only need the value. Composite declarations that recompute a concrete-root
 * value in a renderless instance layer also need the owner to decide whether that recomposition is
 * required at inherited state and breakpoint slots.
 */
export function resolveEffectiveStylePropertyWithSource({
    input,
    surface,
    source,
    property,
    state,
    breakpoint,
    slot,
    domain = 'style',
    valueNormalizer,
    validationProperty,
    includeSourceFallback = false,
}: ResolveEffectiveStylePropertyInput): EffectiveStylePropertyResolution | undefined {
    const rawValue = includeSourceFallback
        ? resolveEffectiveRawStylePropertyWithFallback({
              input,
              source,
              property,
              state,
              breakpoint,
              slot,
              domain,
          })
        : resolveEffectiveRawStyleProperty({ input, source, property, state, breakpoint, slot, domain });

    if (!rawValue) return undefined;
    if (!isDynamicStylePropertyValue(rawValue.value, valueNormalizer)) {
        return { value: rawValue.value, source: rawValue.source };
    }

    const valueSource = rawValue.source;
    return {
        source: valueSource,
        value: createDynamicCssVariableReference({
            input,
            surface,
            sourceUid: valueSource.uid(),
            property,
            state,
            breakpoint: rawValue.originBreakpoint || breakpoint,
            domain,
            valueNormalizer,
            validationProperty,
            omitWhenUndefined: valueSource.capabilities?.().omitUndefinedDynamicValues,
            value: rawValue.value,
        }),
    };
}

/**
 * Resolves the merged style value seen by the legacy inline engine across renderless library instances.
 *
 * Instance style was forwarded to the mounted root and overrode its definition style. Preserve the
 * source that must evaluate a dynamic value while resolving the root chain first and then letting
 * each sparse instance replace it. Layout content uses the separate concrete-root-only branch below.
 * The cached slot belongs only to the original source and must not be reused for fallbacks.
 */
function resolveEffectiveRawStylePropertyWithFallback({
    input,
    source,
    property,
    state,
    breakpoint,
    slot,
    domain = 'style',
}: {
    input: StyleCompilerInput;
    source: StyleElementReader | StyleSectionReader;
    property: string;
    state: string;
    breakpoint: StyleBreakpointName;
    slot?: StyleSlotContext;
    domain?: StylePropertyDomain;
}): RawStyleSlotValue | undefined {
    if (domain === 'content') {
        const contentSource = getDeepestEffectiveFallbackSource(source);
        return resolveEffectiveRawStyleProperty({
            input,
            source: contentSource,
            property,
            state,
            breakpoint,
            slot: contentSource === source ? slot : undefined,
            domain,
        });
    }

    let result: RawStyleSlotValue | undefined;
    const visitedSourceUids = new Set<string>();

    resolveSource(source, slot);
    return result;

    function resolveSource(currentSource: StyleElementReader | StyleSectionReader, currentSlot?: StyleSlotContext) {
        const sourceUid = currentSource.uid();
        if (visitedSourceUids.has(sourceUid)) return;

        visitedSourceUids.add(sourceUid);

        if (currentSource.kind() === 'element') {
            const fallbackSource = (currentSource as StyleElementReader).effectiveFallbackSource?.();
            if (fallbackSource) resolveSource(fallbackSource);
        }

        const currentValue = resolveEffectiveRawStyleProperty({
            input,
            source: currentSource,
            property,
            state,
            breakpoint,
            slot: currentSlot,
            domain,
        });
        if (currentValue) result = currentValue;
    }
}

function getDeepestEffectiveFallbackSource(source: StyleElementReader | StyleSectionReader) {
    let currentSource = source;
    const visitedSourceUids = new Set<string>();

    while (currentSource.kind() === 'element') {
        const sourceUid = currentSource.uid();
        if (visitedSourceUids.has(sourceUid)) break;

        visitedSourceUids.add(sourceUid);
        const fallbackSource = (currentSource as StyleElementReader).effectiveFallbackSource?.();
        if (!fallbackSource || visitedSourceUids.has(fallbackSource.uid())) break;
        currentSource = fallbackSource;
    }

    return currentSource;
}

/**
 * Collects custom CSS property names that can contribute to the current slot.
 *
 * We cannot resolve a custom CSS property until we know its name, so the compiler first collects
 * names and then resolves each key separately.
 */
export function collectCustomCssPropertyNames({
    input,
    source,
    state,
    breakpoint,
    slot,
}: {
    input: StyleCompilerInput;
    source: StyleElementReader | StyleSectionReader;
    state: string;
    breakpoint: StyleBreakpointName;
    slot?: StyleSlotContext;
}) {
    const names = new Set<string>();
    const styleTree = source.style();
    const baseState = slot?.baseState || styleTree.state('base');
    const baseClassIds = slot?.baseClassIds || getStringArray(baseState.classIds());

    if (state === 'base') {
        collectStateBreakpointCustomCssNames(input, names, baseState, baseClassIds, breakpoint);
        return [...names];
    }

    const stateReader = slot?.stateReader || styleTree.state(state);
    const stateClassIds = slot?.stateClassIds || getStringArray(stateReader.classIds());

    collectSubClassCustomCssNames(input, names, stateReader, baseClassIds, breakpoint);
    collectStateBreakpointCustomCssNames(input, names, stateReader, stateClassIds, breakpoint);

    return [...names];
}

/**
 * Returns true for WeWeb formula/dynamic value payloads.
 */
export function isDynamicValue(value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;

    const record = value as CssStyleRecord;
    return !!record.__wwtype || (typeof record.type === 'string' && typeof record.code === 'string');
}

/**
 * Collects formula refs that were coerced into strings while building declarations.
 *
 * Direct values like `value: style.width` are still registered by declaration serialization. This
 * collector handles string-valued expressions like ``calc(${style.width} + 10px)`` where JS turns the
 * ref into `var(--ww-style-width)` before the compiler knows the final selector.
 */
export function collectStringifiedDynamicCssVariableReferences<TResult>(callback: () => TResult) {
    const references: StyleStringifiedDynamicVariableReference[] = [];
    stringifiedDynamicReferenceStack.push(references);

    try {
        return {
            result: callback(),
            references,
        };
    } finally {
        stringifiedDynamicReferenceStack.pop();
    }
}

function createDynamicCssVariableReference({
    input,
    surface,
    sourceUid,
    domain,
    property,
    outputKey,
    valueNormalizer,
    validationProperty,
    omitWhenUndefined,
    state,
    breakpoint,
    value,
    condition,
    runtimeFallback,
    cssFallback,
}: Omit<StyleDynamicVariableBase, 'name' | 'group'> & {
    input: StyleCompilerInput;
    cssFallback?: { value: unknown };
}): StyleDynamicVariableReference {
    const name = createDynamicCssVariableName(domain, property, outputKey);
    const fallbackValue = omitWhenUndefined
        ? NO_DYNAMIC_FALLBACK
        : cssFallback
          ? cssFallback.value
          : resolveDynamicFallback(input, value, {
                sourceUid,
                surface,
                domain,
                property,
                state,
                breakpoint,
                valueNormalizer,
            });
    const variable = {
        name,
        surface,
        group: surface.group,
        sourceUid,
        domain,
        property,
        state,
        breakpoint,
        value,
        outputKey,
        valueNormalizer,
        validationProperty,
        omitWhenUndefined,
        condition,
        runtimeFallback,
    };

    return createReference(fallbackValue);

    function createReference(
        referenceFallback: unknown,
        runtimeOutput?: { kind: 'keyframes'; keyframesName: string }
    ): StyleDynamicVariableReference {
        function toCssText(cssProperty = property) {
            if (referenceFallback === NO_DYNAMIC_FALLBACK) return `var(${name})`;

            const fallbackCssValue = serializeRuntimeCssVariableValue(cssProperty, referenceFallback, {
                valueNormalizer,
            });
            return fallbackCssValue ? `var(${name}, ${fallbackCssValue})` : `var(${name})`;
        }

        const reference: StyleDynamicVariableReference = {
            [STYLE_DYNAMIC_VARIABLE_REFERENCE]: true,
            name,
            get cssText() {
                return toCssText();
            },
            variable,
            withCssFallback(value) {
                return createReference(value, runtimeOutput);
            },
            withCssFallbackIfMissing(value) {
                return createReference(
                    referenceFallback === NO_DYNAMIC_FALLBACK ? value : referenceFallback,
                    runtimeOutput
                );
            },
            asRuntimeKeyframes(keyframesName) {
                return createReference(NO_DYNAMIC_FALLBACK, { kind: 'keyframes', keyframesName });
            },
            toCssText,
            register(options = {}) {
                const cssProperty = options.cssProperty || property;
                const selector = options.selector || surface.selector;
                input.stylesheet.registerProperty?.({
                    name,
                    syntax: '*',
                    inherits: false,
                });
                if (runtimeOutput) {
                    input.stylesheet.dynamicVariable?.({
                        ...variable,
                        ...runtimeOutput,
                        cssProperty,
                        validationProperty: validationProperty || options.validationProperty,
                        directDeclaration: options.directDeclaration,
                        selector,
                    });
                } else {
                    input.stylesheet.dynamicVariable?.({
                        ...variable,
                        cssProperty,
                        validationProperty: validationProperty || options.validationProperty,
                        directDeclaration: options.directDeclaration,
                        selector,
                    });
                }
            },
            toString() {
                const cssText = toCssText();
                collectStringifiedDynamicCssVariableReference(reference, cssText);
                return cssText;
            },
            [Symbol.toPrimitive]() {
                const cssText = toCssText();
                collectStringifiedDynamicCssVariableReference(reference, cssText);
                return cssText;
            },
        };

        return reference;
    }
}

/**
 * Creates a formula-backed CSS variable that is only written while its runtime condition, or every
 * condition in an array, matches. The explicit CSS fallback keeps the declaration deterministic
 * before runtime formulas resolve.
 */
export function createConditionalDynamicCssVariableReference({
    input,
    surface,
    sourceUid,
    domain,
    property,
    outputKey,
    valueNormalizer,
    state,
    breakpoint,
    value,
    condition,
    cssFallbackValue,
}: Omit<StyleDynamicVariableBase, 'name' | 'group'> & {
    input: StyleCompilerInput;
    condition: NonNullable<StyleDynamicVariableBase['condition']>;
    cssFallbackValue: unknown;
}) {
    return createDynamicCssVariableReference({
        input,
        surface,
        sourceUid,
        domain,
        property,
        outputKey,
        valueNormalizer,
        state,
        breakpoint,
        value,
        condition,
        cssFallback: { value: cssFallbackValue },
    });
}

/**
 * Creates a CSS variable whose runtime value can fall back after a related value group resolves.
 *
 * Unlike a CSS `var()` fallback, this decision requires formula results and therefore cannot be
 * made while compiling the stylesheet.
 */
export function createWhenAllEmptyDynamicCssVariableReference({
    input,
    surface,
    sourceUid,
    domain,
    property,
    outputKey,
    valueNormalizer,
    omitWhenUndefined,
    state,
    breakpoint,
    value,
    condition,
    runtimeFallback,
    cssFallbackValue,
}: Omit<StyleDynamicVariableBase, 'name' | 'group'> & {
    input: StyleCompilerInput;
    runtimeFallback: Extract<NonNullable<StyleDynamicVariableBase['runtimeFallback']>, { type: 'when-all-empty' }>;
    cssFallbackValue: unknown;
}) {
    return createDynamicCssVariableReference({
        input,
        surface,
        sourceUid,
        domain,
        property,
        outputKey,
        valueNormalizer,
        omitWhenUndefined,
        state,
        breakpoint,
        value,
        condition,
        runtimeFallback,
        cssFallback: { value: cssFallbackValue },
    });
}

/**
 * Creates one runtime variable with an ordered secondary value.
 *
 * The primary and fallback formulas are resolved by the same runtime registration. This avoids
 * independently clearing a CSS declaration when a nested fallback fragment resolves empty.
 */
export function createWhenEmptyDynamicCssVariableReference({
    input,
    surface,
    sourceUid,
    domain,
    property,
    outputKey,
    valueNormalizer,
    state,
    breakpoint,
    value,
    condition,
    runtimeFallback,
    cssFallbackValue,
}: Omit<StyleDynamicVariableBase, 'name' | 'group'> & {
    input: StyleCompilerInput;
    runtimeFallback: Extract<NonNullable<StyleDynamicVariableBase['runtimeFallback']>, { type: 'when-empty' }>;
    cssFallbackValue?: unknown;
}) {
    const request = {
        sourceUid,
        surface,
        domain,
        property,
        state,
        breakpoint,
    };
    const primaryFallback = resolveFallbackCandidate(input, value, { ...request, valueNormalizer });
    const primaryCssValue = serializeFallbackCandidate(property, primaryFallback, valueNormalizer);
    let fallbackValue = cssFallbackValue === undefined ? primaryFallback : cssFallbackValue;
    if (cssFallbackValue === undefined && !primaryCssValue) {
        const emptyFallback = resolveFallbackCandidate(input, runtimeFallback.value, {
            ...request,
            valueNormalizer: runtimeFallback.valueNormalizer,
        });
        fallbackValue =
            serializeFallbackCandidate(property, emptyFallback, runtimeFallback.valueNormalizer) || NO_DYNAMIC_FALLBACK;
    }

    return createDynamicCssVariableReference({
        input,
        surface,
        sourceUid,
        domain,
        property,
        outputKey,
        valueNormalizer,
        state,
        breakpoint,
        value,
        condition,
        runtimeFallback,
        cssFallback: { value: fallbackValue },
    });
}

function collectStringifiedDynamicCssVariableReference(reference: StyleDynamicVariableReference, cssText: string) {
    const references = stringifiedDynamicReferenceStack[stringifiedDynamicReferenceStack.length - 1];
    if (references) references.push({ reference, cssText });
}

function resolveDynamicFallback(
    input: StyleCompilerInput,
    formula: unknown,
    request: Parameters<NonNullable<StyleCompilerInput['resolveFormulaFallback']>>[1]
) {
    const configuredStaticValue = getFormulaStaticValue(formula);
    if (configuredStaticValue?.status === 'resolved') {
        const cssValue = serializeRuntimeCssVariableValue(request.property, configuredStaticValue.value, {
            valueNormalizer: request.valueNormalizer,
        });
        if (!isDynamicValue(configuredStaticValue.value) && cssValue !== undefined) return configuredStaticValue.value;
    }

    const result = input.resolveFormulaFallback?.(formula, request);
    return result?.status === 'resolved' ? result.value : NO_DYNAMIC_FALLBACK;
}

function resolveFallbackCandidate(
    input: StyleCompilerInput,
    value: unknown,
    request: Parameters<NonNullable<StyleCompilerInput['resolveFormulaFallback']>>[1]
) {
    return isDynamicValue(value) ? resolveDynamicFallback(input, value, request) : value;
}

function serializeFallbackCandidate(property: string, value: unknown, valueNormalizer?: StyleCssValueNormalizer) {
    if (value === NO_DYNAMIC_FALLBACK) return undefined;

    return serializeRuntimeCssVariableValue(property, value, { valueNormalizer });
}

function createDynamicCssVariableName(domain: StylePropertyDomain, property: string, outputKey?: string) {
    const sourceProperty = property.startsWith('customCss.') ? property.slice('customCss.'.length) : property;
    const normalizedProperty = normalizeDynamicCssVariableNamePart(sourceProperty);
    const normalizedOutputKey = outputKey ? normalizeDynamicCssVariableNamePart(outputKey) : '';

    return `--ww-${domain}-${[normalizedProperty, normalizedOutputKey].filter(Boolean).join('-') || 'value'}`;
}

/**
 * Maps a resolved source value to the final CSS value declared by component config.
 */
export { mapStyleValue, normalizeStyleRuntimeValue } from './valueNormalization';

function normalizeDynamicCssVariableNamePart(value: string) {
    return value
        .replace(/[A-Z]/g, char => `-${char.toLowerCase()}`)
        .replace(/^--+/, '')
        .replace(/[^a-zA-Z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .toLowerCase();
}

/**
 * Returns true for CSS custom-property placeholders generated by this compiler.
 *
 * These values are valid CSS declaration values, but compiler-side branching must not treat them as
 * ordinary strings or booleans because their real value is only known at runtime.
 */
export function isDynamicCssVariableReference(value: unknown): value is string | StyleDynamicVariableReference {
    return (
        isStyleDynamicVariableReference(value) ||
        (typeof value === 'string' && (value.startsWith('var(--ww-style-') || value.startsWith('var(--ww-content-')))
    );
}

/**
 * Returns true for compiler-owned dynamic variable reference objects.
 */
export function isStyleDynamicVariableReference(value: unknown): value is StyleDynamicVariableReference {
    return !!(
        value &&
        typeof value === 'object' &&
        (value as Partial<StyleDynamicVariableReference>)[STYLE_DYNAMIC_VARIABLE_REFERENCE] === true
    );
}

/**
 * Resolves the authored cascade without creating a CSS-variable reference or discovering a static
 * formula fallback. Composite declarations use this for secondary values that are only needed
 * after their primary value resolves empty.
 */
export function resolveRawStyleProperty({
    input,
    source,
    property,
    state,
    breakpoint,
    slot,
    domain = 'style',
}: {
    input: StyleCompilerInput;
    source: StyleElementReader | StyleSectionReader;
    property: string;
    state: string;
    breakpoint: StyleBreakpointName;
    slot?: StyleSlotContext;
    domain?: StylePropertyDomain;
}): unknown {
    const propertyTree = getSourcePropertyTree(source, domain);
    const baseState = slot?.baseState || propertyTree.state('base');
    const baseClassIds = slot?.baseClassIds || getStringArray(baseState.classIds());

    if (state === 'base') {
        return resolveStateBreakpointProperty({
            input,
            sourceState: baseState,
            classIds: baseClassIds,
            property,
            breakpoint,
            domain,
        });
    }
    if (propertyTree.supportsState?.(property) === false) return undefined;

    const stateReader = slot?.stateReader || propertyTree.state(state);
    const stateClassIds = slot?.stateClassIds || getStringArray(stateReader.classIds());
    let result = resolveSubClassProperty({
        input,
        stateReader,
        classIds: baseClassIds,
        property,
        breakpoint,
        domain,
    });
    const stateValue = resolveStateBreakpointProperty({
        input,
        sourceState: stateReader,
        classIds: stateClassIds,
        property,
        breakpoint,
        domain,
    });

    if (stateValue !== undefined) result = stateValue;
    return result;
}

function resolveRawStylePropertyWithOrigin({
    input,
    source,
    property,
    state,
    breakpoint,
    slot,
    domain = 'style',
}: {
    input: StyleCompilerInput;
    source: StyleElementReader | StyleSectionReader;
    property: string;
    state: string;
    breakpoint: StyleBreakpointName;
    slot?: StyleSlotContext;
    domain?: StylePropertyDomain;
}): RawStylePropertyResolution | undefined {
    const propertyTree = getSourcePropertyTree(source, domain);
    const baseState = slot?.baseState || propertyTree.state('base');
    const baseClassIds = slot?.baseClassIds || getStringArray(baseState.classIds());
    const candidates: RawStylePropertyCandidate[] = [];

    if (state === 'base') {
        appendClassPropertyCandidates({
            input,
            candidates,
            sourceState: baseState,
            classIds: baseClassIds,
            breakpoint,
            domain,
        });
        candidates.push({ kind: 'source', reader: baseState.breakpoint(breakpoint) });
    } else {
        if (propertyTree.supportsState?.(property) === false) return undefined;

        const stateReader = slot?.stateReader || propertyTree.state(state);
        const stateClassIds = slot?.stateClassIds || getStringArray(stateReader.classIds());

        appendSubClassPropertyCandidates({
            input,
            candidates,
            stateReader,
            classIds: baseClassIds,
            breakpoint,
            domain,
        });
        appendClassPropertyCandidates({
            input,
            candidates,
            sourceState: stateReader,
            classIds: stateClassIds,
            breakpoint,
            domain,
        });
        candidates.push({ kind: 'source', reader: stateReader.breakpoint(breakpoint) });
    }

    let result: RawStylePropertyResolution | undefined;
    for (const [precedence, candidate] of candidates.entries()) {
        const value = candidate.reader.property(property);
        if (value === undefined) continue;

        result = {
            value,
            origin: { kind: candidate.kind, precedence },
        };
    }

    return result;
}

function appendClassPropertyCandidates({
    input,
    candidates,
    sourceState,
    classIds,
    breakpoint,
    domain,
}: {
    input: StyleCompilerInput;
    candidates: RawStylePropertyCandidate[];
    sourceState: StyleStateReader;
    classIds: string[];
    breakpoint: StyleBreakpointName;
    domain: StylePropertyDomain;
}) {
    for (const classId of classIds) {
        const classReader = input.reader.styleClass?.(classId);
        if (classReader) {
            candidates.push({
                kind: 'class',
                reader: getClassPropertyTree(classReader, domain).state('base').breakpoint(breakpoint),
            });
        }

        appendSubClassPropertyCandidates({
            input,
            candidates,
            stateReader: sourceState,
            classIds: [classId],
            breakpoint,
            domain,
        });
    }
}

function appendSubClassPropertyCandidates({
    input,
    candidates,
    stateReader,
    classIds,
    breakpoint,
    domain,
}: {
    input: StyleCompilerInput;
    candidates: RawStylePropertyCandidate[];
    stateReader: StyleStateReader;
    classIds: string[];
    breakpoint: StyleBreakpointName;
    domain: StylePropertyDomain;
}) {
    for (const classId of classIds) {
        const classReader = input.reader.styleClass?.(classId);
        if (!classReader) continue;

        for (const subClassId of getStringArray(stateReader.subClassIds(classId))) {
            const subClassReader = classReader.subClass(subClassId);
            if (!subClassReader) continue;

            candidates.push({
                kind: 'subclass',
                reader: getClassPropertyTree(subClassReader, domain).state('base').breakpoint(breakpoint),
            });
        }
    }
}

function resolveEffectiveRawStyleProperty({
    input,
    source,
    property,
    state,
    breakpoint,
    slot,
    domain = 'style',
}: {
    input: StyleCompilerInput;
    source: StyleElementReader | StyleSectionReader;
    property: string;
    state: string;
    breakpoint: StyleBreakpointName;
    slot?: StyleSlotContext;
    domain?: StylePropertyDomain;
}): RawStyleSlotValue | undefined {
    let result: RawStyleSlotValue | undefined;
    const propertyTree = getSourcePropertyTree(source, domain);
    const baseState = slot?.baseState || propertyTree.state('base');
    const baseClassIds = slot?.baseClassIds || getStringArray(baseState.classIds());
    const inheritedBreakpointNames = getInheritedBreakpointNames(breakpoint);

    for (const inheritedBreakpoint of inheritedBreakpointNames) {
        const nextValue = resolveStateBreakpointProperty({
            input,
            sourceState: baseState,
            classIds: baseClassIds,
            property,
            breakpoint: inheritedBreakpoint,
            domain,
        });

        if (nextValue !== undefined) {
            result = {
                value: nextValue,
                originBreakpoint: inheritedBreakpoint,
                source,
            };
        }
    }

    if (state === 'base') return result;
    if (propertyTree.supportsState?.(property) === false) return result;

    const stateReader = slot?.stateReader || propertyTree.state(state);
    const stateClassIds = slot?.stateClassIds || getStringArray(stateReader.classIds());

    for (const inheritedBreakpoint of inheritedBreakpointNames) {
        const nextValue = resolveSubClassProperty({
            input,
            stateReader,
            classIds: baseClassIds,
            property,
            breakpoint: inheritedBreakpoint,
            domain,
        });

        if (nextValue !== undefined) {
            result = {
                value: nextValue,
                originBreakpoint: inheritedBreakpoint,
                source,
            };
        }
    }

    for (const inheritedBreakpoint of inheritedBreakpointNames) {
        const nextValue = resolveStateBreakpointProperty({
            input,
            sourceState: stateReader,
            classIds: stateClassIds,
            property,
            breakpoint: inheritedBreakpoint,
            domain,
        });

        if (nextValue !== undefined) {
            result = {
                value: nextValue,
                originBreakpoint: inheritedBreakpoint,
                source,
            };
        }
    }

    return result;
}

/**
 * Resolves a property for one state+breakpoint slot.
 *
 * Class values are applied first, then direct source value wins.
 */
function resolveStateBreakpointProperty({
    input,
    sourceState,
    classIds,
    property,
    breakpoint,
    domain,
}: {
    input: StyleCompilerInput;
    sourceState: StyleStateReader;
    classIds: string[];
    property: string;
    breakpoint: StyleBreakpointName;
    domain: StylePropertyDomain;
}): unknown {
    let result = resolveClassProperty({
        input,
        sourceState,
        classIds,
        property,
        breakpoint,
        domain,
    });
    const sourceValue = sourceState.breakpoint(breakpoint).property(property);
    // Direct element/section style wins over class style for the same breakpoint.
    if (sourceValue !== undefined) result = sourceValue;

    return result;
}

/**
 * Resolves class and subclass values for one property.
 *
 * Class order is meaningful: later class ids override earlier class ids, and each class can also
 * activate subclasses through the current source state.
 */
function resolveClassProperty({
    input,
    sourceState,
    classIds,
    property,
    breakpoint,
    domain,
}: {
    input: StyleCompilerInput;
    sourceState: StyleStateReader;
    classIds: string[];
    property: string;
    breakpoint: StyleBreakpointName;
    domain: StylePropertyDomain;
}): unknown {
    let result: unknown;

    for (const classId of classIds) {
        const classReader = input.reader.styleClass?.(classId);
        const classValue = classReader
            ? getClassPropertyTree(classReader, domain).state('base').breakpoint(breakpoint).property(property)
            : undefined;
        if (classValue !== undefined) result = classValue;

        const subClassValue = resolveSubClassProperty({
            input,
            stateReader: sourceState,
            classIds: [classId],
            property,
            breakpoint,
            domain,
        });
        if (subClassValue !== undefined) result = subClassValue;
    }

    return result;
}

/**
 * Resolves subclass values for one property.
 *
 * Subclasses are stored under the owning style class. The state reader only tells us which subclass
 * ids are active for that class on the current source.
 */
function resolveSubClassProperty({
    input,
    stateReader,
    classIds,
    property,
    breakpoint,
    domain,
}: {
    input: StyleCompilerInput;
    stateReader: StyleStateReader;
    classIds: string[];
    property: string;
    breakpoint: StyleBreakpointName;
    domain: StylePropertyDomain;
}): unknown {
    let result: unknown;

    for (const classId of classIds) {
        const classReader = input.reader.styleClass?.(classId);
        if (!classReader) continue;

        for (const subClassId of getStringArray(stateReader.subClassIds(classId))) {
            const subClassReader = classReader.subClass(subClassId);
            const value = subClassReader
                ? getClassPropertyTree(subClassReader, domain).state('base').breakpoint(breakpoint).property(property)
                : undefined;
            if (value !== undefined) result = value;
        }
    }

    return result;
}

function resolveRawCustomCssProperty({
    input,
    source,
    property,
    state,
    breakpoint,
    slot,
}: {
    input: StyleCompilerInput;
    source: StyleElementReader | StyleSectionReader;
    property: string;
    state: string;
    breakpoint: StyleBreakpointName;
    slot?: StyleSlotContext;
}): unknown {
    const styleTree = source.style();
    const baseState = slot?.baseState || styleTree.state('base');
    const baseClassIds = slot?.baseClassIds || getStringArray(baseState.classIds());

    if (state === 'base') {
        return resolveStateBreakpointCustomCssProperty({
            input,
            sourceState: baseState,
            classIds: baseClassIds,
            property,
            breakpoint,
        });
    }

    const stateReader = slot?.stateReader || styleTree.state(state);
    const stateClassIds = slot?.stateClassIds || getStringArray(stateReader.classIds());
    let result = resolveSubClassCustomCssProperty({
        input,
        stateReader,
        classIds: baseClassIds,
        property,
        breakpoint,
    });
    const stateValue = resolveStateBreakpointCustomCssProperty({
        input,
        sourceState: stateReader,
        classIds: stateClassIds,
        property,
        breakpoint,
    });

    if (stateValue !== undefined) result = stateValue;
    return result;
}

/**
 * Resolves a custom CSS property for one state+breakpoint slot.
 */
function resolveStateBreakpointCustomCssProperty({
    input,
    sourceState,
    classIds,
    property,
    breakpoint,
}: {
    input: StyleCompilerInput;
    sourceState: StyleStateReader;
    classIds: string[];
    property: string;
    breakpoint: StyleBreakpointName;
}): unknown {
    let result = resolveClassCustomCssProperty({
        input,
        sourceState,
        classIds,
        property,
        breakpoint,
    });
    const sourceValue = sourceState.breakpoint(breakpoint).customCssProperty(property);
    if (sourceValue !== undefined) result = sourceValue;

    return result;
}

/**
 * Resolves custom CSS object entries from classes in class order.
 */
function resolveClassCustomCssProperty({
    input,
    sourceState,
    classIds,
    property,
    breakpoint,
}: {
    input: StyleCompilerInput;
    sourceState: StyleStateReader;
    classIds: string[];
    property: string;
    breakpoint: StyleBreakpointName;
}): unknown {
    let result: unknown;

    for (const classId of classIds) {
        const classReader = input.reader.styleClass?.(classId);
        const classValue = classReader?.style().state('base').breakpoint(breakpoint).customCssProperty(property);
        if (classValue !== undefined) result = classValue;

        const subClassValue = resolveSubClassCustomCssProperty({
            input,
            stateReader: sourceState,
            classIds: [classId],
            property,
            breakpoint,
        });
        if (subClassValue !== undefined) result = subClassValue;
    }

    return result;
}

/**
 * Resolves custom CSS object entries from active subclasses.
 */
function resolveSubClassCustomCssProperty({
    input,
    stateReader,
    classIds,
    property,
    breakpoint,
}: {
    input: StyleCompilerInput;
    stateReader: StyleStateReader;
    classIds: string[];
    property: string;
    breakpoint: StyleBreakpointName;
}): unknown {
    let result: unknown;

    for (const classId of classIds) {
        const classReader = input.reader.styleClass?.(classId);
        if (!classReader) continue;

        for (const subClassId of getStringArray(stateReader.subClassIds(classId))) {
            const value = classReader
                .subClass(subClassId)
                ?.style()
                .state('base')
                .breakpoint(breakpoint)
                .customCssProperty(property);
            if (value !== undefined) result = value;
        }
    }

    return result;
}

/**
 * Collects custom CSS keys from classes, subclasses, then direct source entries for one
 * state+breakpoint slot.
 */
function collectStateBreakpointCustomCssNames(
    input: StyleCompilerInput,
    names: Set<string>,
    sourceState: StyleStateReader,
    classIds: string[],
    breakpoint: StyleBreakpointName
) {
    for (const classId of classIds) {
        collectClassCustomCssNames(input.reader.styleClass?.(classId), names, breakpoint);
        for (const subClassId of getStringArray(sourceState.subClassIds(classId))) {
            collectClassCustomCssNames(input.reader.styleClass?.(classId)?.subClass(subClassId), names, breakpoint);
        }
    }

    for (const [property] of sourceState.breakpoint(breakpoint).customCssEntries()) {
        if (property) names.add(property);
    }
}

/**
 * Collects subclass custom CSS keys that are only active for the current state.
 */
function collectSubClassCustomCssNames(
    input: StyleCompilerInput,
    names: Set<string>,
    stateReader: StyleStateReader,
    classIds: string[],
    breakpoint: StyleBreakpointName
) {
    for (const classId of classIds) {
        const classReader = input.reader.styleClass?.(classId);
        if (!classReader) continue;

        for (const subClassId of getStringArray(stateReader.subClassIds(classId))) {
            collectClassCustomCssNames(classReader.subClass(subClassId), names, breakpoint);
        }
    }
}

/**
 * Collects custom CSS keys from a class reader when the class exists.
 *
 * Class readers can be absent in partial publisher/editor inputs; missing classes simply do not
 * contribute to the cascade.
 */
function collectClassCustomCssNames(
    classReader: StyleClassReader | null | undefined,
    names: Set<string>,
    breakpoint: StyleBreakpointName
) {
    if (!classReader) return;

    for (const [property] of classReader.style().state('base').breakpoint(breakpoint).customCssEntries()) {
        if (property) names.add(property);
    }
}

function getSourcePropertyTree(source: StyleElementReader | StyleSectionReader, domain: StylePropertyDomain) {
    return domain === 'style' ? source.style() : source.content();
}

function getClassPropertyTree(classReader: StyleClassReader, domain: StylePropertyDomain): StylePropertyTreeReader {
    return domain === 'style' ? classReader.style() : classReader.content();
}

function getInheritedBreakpointNames(breakpoint: StyleBreakpointName): StyleBreakpointName[] {
    const breakpointIndex = STYLE_BREAKPOINTS.findIndex(({ name }) => name === breakpoint);
    return STYLE_BREAKPOINTS.slice(0, breakpointIndex + 1).map(({ name }) => name);
}

/**
 * Filters arbitrary reader output to a string array.
 */
function getStringArray(value: unknown) {
    // Reader implementations should return strings, but this keeps the compiler resilient to
    // malformed data without throwing during stylesheet generation.
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}
