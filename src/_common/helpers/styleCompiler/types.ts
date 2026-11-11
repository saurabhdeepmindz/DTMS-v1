/**
 * Public contract for the shared style compiler.
 *
 * Keep this file runtime dependency-free so the same types can be reused by editor adapters,
 * publisher adapters, and tests.
 */
import type { StyleBreakpointName } from './breakpoints';
import type { FormulaExecutionResult } from '../formulaExecutor/types';

/**
 * Rendered styling surface handled by the compiler.
 */
export type StyleSurfaceKind =
    | 'element'
    | 'element-layout'
    | 'section-container'
    | 'section-element'
    | 'section-layout';

/**
 * Concrete CSS surface produced from a source reader.
 */
export type StyleSurface = {
    key: string;
    kind: StyleSurfaceKind;
    /**
     * Final compiler-owned CSS selector for the rendered surface.
     */
    selector: string;
    /**
     * Selector fragment replaced by the runtime instance selector when writing dynamic CSS vars.
     *
     * This can be narrower than `selector` for layout surfaces, for example replacing the owning
     * element selector inside `.ww-e-x [data-ww-ls~="x"]`.
     */
    runtimeScopeSelector?: string;
    /**
     * Cascade group that owns the generated surface.
     */
    group: StyleRuleGroup;
    /**
     * Library cascade role for this rendered surface.
     *
     * Concrete definition styles stay below renderless instance overrides, matching the legacy
     * merge order even when the concrete root uses a more-specific surface selector.
     */
    libraryLayer?: StyleLibraryLayer;
};

/**
 * CSS cascade layers used by generated/project styling, from lowest to highest priority.
 *
 * Adapters must keep this order stable even when reactive chunks are disposed and reinserted.
 */
export const STYLE_RESET_LAYER = 'ww-style-reset';
export const STYLE_CORE_LAYER = 'ww-style-core';
export const STYLE_COMPONENT_LAYER = 'ww-style-component';
export const STYLE_LAYOUT_OVERRIDE_LAYER = 'ww-style-layout-override';
export const STYLE_RUNTIME_LAYER = 'ww-style-runtime';

export const STYLE_RULE_GROUPS = ['library', 'section', 'element'] as const;

export type StyleRuleGroup = (typeof STYLE_RULE_GROUPS)[number];

/**
 * Generated CSS cascade layer names, ordered from lowest to highest generated priority.
 */
export const STYLE_RULE_GROUP_LAYERS = {
    library: 'ww-style-library',
    section: 'ww-style-section',
    element: 'ww-style-element',
} as const satisfies Record<StyleRuleGroup, string>;

export const STYLE_LIBRARY_LAYER_ORDER = ['definition', 'instance'] as const;

export type StyleLibraryLayer = (typeof STYLE_LIBRARY_LAYER_ORDER)[number];

export const STYLE_LAYER_ORDER = [
    STYLE_RESET_LAYER,
    STYLE_COMPONENT_LAYER,
    STYLE_CORE_LAYER,
    STYLE_RULE_GROUP_LAYERS.library,
    STYLE_RULE_GROUP_LAYERS.section,
    STYLE_RULE_GROUP_LAYERS.element,
    STYLE_LAYOUT_OVERRIDE_LAYER,
    STYLE_RUNTIME_LAYER,
] as const;

/**
 * Stops a style compiler scope and runs registered cleanups.
 */
export type StyleScopeStop = () => void;

/**
 * Registers cleanup inside the current style scope.
 */
export type StyleScopeDispose = (cleanup: () => void) => void;

/**
 * Static runtime sentinel.
 *
 * The compiler still uses the same effect-scope algorithm in static mode. Effects just execute
 * once instead of subscribing to a reactive system.
 */
export const STATIC_STYLE_RUNTIME = Symbol.for('weweb.styleCompiler.staticRuntime');

/**
 * Runtime-agnostic style compiler reactivity hook.
 *
 * Editor mode can map scopes to Vue effect scopes/watch effects. Static publisher mode uses
 * `STATIC_STYLE_RUNTIME` instead of an object implementation.
 */
export type StyleReactivityRuntime = {
    createScope(): StyleReactivityScope;
    effect(callback: (onDispose: StyleScopeDispose) => void): StyleScopeStop;
};

/**
 * Reactivity backend used by the compiler.
 */
export type StyleRuntime = typeof STATIC_STYLE_RUNTIME | StyleReactivityRuntime;

/**
 * Owns reactive compiler effects created while `run()` is active.
 *
 * Vue implementations can return `effectScope()` directly. `runtime.effect()` can map to
 * `watchEffect`; Vue will attach the watcher to the current active scope.
 */
export type StyleReactivityScope = {
    run<TResult>(callback: () => TResult): TResult | undefined;
    stop(): void;
};

/**
 * Flat list of sources to compile.
 *
 * The reader decides how to find the actual data, which keeps publisher/editor storage details out
 * of the compiler.
 */
export type StyleCompileScope = {
    elementUids: readonly string[];
    sectionUids: readonly string[];
    /**
     * Library component definition elements, including internal children.
     *
     * These targets are emitted in the library layer only. If an adapter accidentally also exposes
     * one of these uids through `elementUids`, the compiler keeps the library target and skips the
     * element target so library defaults do not compete with page instance styles in the same layer.
     */
    libraryElementUids?: readonly string[];
    libraryComponentIds: readonly string[];
};

/**
 * Normalized component-level CSS capabilities.
 *
 * Adapters derive this from WeWeb component configuration. The compiler intentionally consumes this
 * small contract instead of importing full component config modules or reaching into runtime
 * component internals.
 */
export type StyleComponentCapabilities = {
    inherits?: readonly StyleInheritanceCapability[];
    /** Uses the rendered content size when no explicit element width is configured. */
    autoByContent?: boolean;
    displayAllowedValues?: readonly string[];
    /**
     * Leaves dynamic declarations inactive when their formula resolves to `undefined`.
     *
     * Library component instances historically ignored unresolved style overrides and kept the
     * concrete root value instead.
     */
    omitUndefinedDynamicValues?: boolean;
    ignoredStyleProperties?: readonly string[];
    /**
     * Component CSS hooks to execute for every compiled state/breakpoint slot.
     *
     * Adapters may prepend inherited component contracts, for example `ww-text.css()`, before the
     * source component hook.
     */
    css?: StyleCssFactory | readonly StyleCssFactory[];
};

export type StyleConfiguredState =
    | string
    | {
          label: string;
          selector?: string;
          selectors?: readonly string[];
      };

export type StyleStateDescriptor = {
    id: string;
    label?: string;
    selectors?: readonly string[];
    /**
     * Parent state metadata for states stored as `_wwParent_<uid>_<state>`.
     *
     * `id` remains the persisted child state key used to read styles. The nested parent metadata is
     * only used to generate selectors such as `.parent:focus-within .child`.
     */
    parent?: StyleParentStateDescriptor;
};

export type StyleParentStateDescriptor = {
    uid: string;
    stateId: string;
    selectors?: readonly string[];
    /**
     * Testing/adapter selector override.
     *
     * Production selectors are compiler-owned and generated from the parent uid whenever possible.
     */
    selector?: string;
};

export type StyleInheritanceCapability =
    | string
    | {
          type: string;
          exclude?: readonly string[];
      };

export type StyleCssFactory = (context: StyleCssFactoryContext) => readonly StyleCssOutput[] | null | undefined;

export type StyleCssFactoryContext = {
    /**
     * Current source state compiled by this hook, for example `base` or `_wwHover`.
     */
    state: string;
    /**
     * Current responsive breakpoint compiled by this hook.
     */
    breakpoint: StyleBreakpointName;
    /**
     * Component content proxy for the current state/breakpoint slot.
     *
     * Reads are intentionally flat: `content.foo` is compiler-resolved and formula-safe, but nested
     * objects are returned as plain values and are not recursively converted to CSS variables.
     */
    content: StyleCssPropertyProxy;
    /**
     * Generic style proxy for the current state/breakpoint slot.
     *
     * Reads are intentionally flat: `style.width` is compiler-resolved and formula-safe, but nested
     * objects are returned as plain values and are not recursively converted to CSS variables.
     */
    style: StyleCssPropertyProxy;
};

export type StyleCssValueMap = {
    trueValue?: unknown;
    falseValue?: unknown;
};

export type StyleCssValueNormalizer =
    | {
          type: 'map';
          map: StyleCssValueMap;
      }
    | {
          type: 'empty-fallback';
          fallbackValue: unknown;
      }
    | {
          /** Reproduces legacy `value || fallback` semantics, including numeric zero. */
          type: 'falsy-fallback';
          fallbackValue: unknown;
      }
    | {
          /** Reproduces legacy `getComponentSize`: falsy values and `auto` use the configured fallback. */
          type: 'component-size';
          fallbackValue?: unknown;
      }
    | {
          /** Treats every falsy runtime value as absent so grouped fallbacks can decide the result. */
          type: 'empty-if-falsy';
      }
    | {
          /** Prefixes a truthy fragment while keeping falsy fragments empty for ordered fallbacks. */
          type: 'prefix-if-truthy';
          prefix: string;
      }
    | {
          /** Serializes legacy array-backed CSS lists with the same `Array#join(' ') || fallback` semantics. */
          type: 'space-separated-list';
          fallbackValue: unknown;
      }
    | {
          type: 'display';
          allowedValues: readonly string[];
          restrictToAllowedValues: boolean;
      }
    | {
          /** Normalizes legacy raw image paths into a CSS `<image>` value. */
          type: 'background-image';
          assetBaseUrl?: string;
          fallbackValue?: unknown;
      };

export type StyleCssPropertyProxy = Record<string, unknown> & {
    /**
     * Maps one source value to a CSS-ready value while preserving formula support.
     *
     * The output key differentiates several CSS variables derived from the same source property, for
     * example `_ww-text_nowrap` driving both `white-space` and `overflow`.
     */
    _mapValue(property: string, outputKey: string, valueMap: StyleCssValueMap): unknown;
};

export type StyleCssOutput = {
    property: string;
    value: unknown;
};

export type StyleCompilerMode = 'static' | 'runtime' | 'editor';

/**
 * Input required to compile a stylesheet.
 */
export type StyleCompilerInput<TResult = unknown> = {
    scope: StyleCompileScope;
    reader: StyleReader;
    stylesheet: StyleSheetAdapter<TResult>;
    /**
     * Optional base URL used to resolve relative WeWeb assets such as `designs/...`.
     *
     * Editor adapters provide their environment CDN URL. Published-front adapters may omit it to
     * preserve document-relative asset resolution.
     */
    assetBaseUrl?: string;
    /**
     * Optional so static one-shot compilation is the default behavior.
     */
    runtime?: StyleRuntime;
    /**
     * Static mode emits build-time CSS. Runtime mode registers dynamic variable metadata without
     * emitting generated static rules. Editor mode emits runtime CSS plus editor-only forced-state
     * selectors for side-panel state preview.
     *
     * Defaults to `static`.
     */
    mode?: StyleCompilerMode;
    /**
     * Optional best-effort resolver used to add static fallbacks to formula-backed CSS variables.
     * Runtime formula execution remains adapter-owned and authoritative.
     */
    resolveFormulaFallback?: StyleFormulaFallbackResolver;
};

export type StyleFormulaFallbackRequest = {
    sourceUid: string;
    surface: StyleSurface;
    domain: StylePropertyDomain;
    property: string;
    state: string;
    breakpoint: StyleBreakpointName;
    valueNormalizer?: StyleCssValueNormalizer;
};

export type StyleFormulaFallbackResolver = (
    formula: unknown,
    request: StyleFormulaFallbackRequest
) => FormulaExecutionResult;

/**
 * Result of a stylesheet compilation.
 */
export type StyleCompilerRun<TResult = unknown> = {
    result: TResult;
    stop: StyleScopeStop;
};

/**
 * Lazy data access layer used by the compiler.
 *
 * Editor implementations can make these reads reactive; publisher implementations can read plain
 * serialized data.
 */
export type StyleReader = {
    element(uid: string): StyleElementReader | null;
    section(uid: string): StyleSectionReader | null;
    libraryComponent(id: string): StyleLibraryComponentReader | null;
    styleClass?: (id: string) => StyleClassReader | null;
};

/**
 * Reader for element style data.
 */
export type StyleElementReader = StyleSourceReader & {
    kind(): 'element';
    /** Whether this source is a renderless library component instance. */
    isLibraryComponentInstance?(): boolean;
    /**
     * Source whose effective values are inherited before this element's sparse overrides.
     *
     * This is intentionally consumed only by composite declaration resolution. Normal property
     * declarations stay sparse and rely on the definition/instance CSS cascade.
     */
    effectiveFallbackSource?(): StyleElementReader | null;
    /**
     * Whether the element is listed directly in its containing section's root slot.
     *
     * `parentRef()` cannot answer this: serialized descendants also retain their containing
     * section id so parent-state selectors can target it.
     */
    isDirectSectionChild(): boolean;
};

/**
 * Reader for section style data.
 */
export type StyleSectionReader = StyleSourceReader & {
    kind(): 'section';
};

/**
 * Reader for library component definition metadata needed by the compiler.
 */
export type StyleLibraryComponentReader = {
    rootElementUid(): string | undefined;
    /**
     * Library component definitions rendered by this component definition.
     *
     * The compiler uses this dependency list to emit nested library defaults before the component
     * that consumes them, so normal CSS order keeps outer component styles as overrides.
     */
    childLibraryComponentIds?(): readonly string[];
};

/**
 * Parent styling context used to resolve parent state selectors.
 *
 * This is not a structural parent relation: serialized descendants can reference their containing
 * section even when another element is their direct DOM parent.
 */
export type StyleParentRef = {
    uid: string;
    styleSourceId?: number;
    /**
     * Testing-only selector override.
     *
     * Production parent selectors are compiler-owned and generated from `uid`.
     */
    selector?: string;
};

/**
 * Shared reader API for sources that own stateful, responsive style data.
 */
export type StyleSourceReader = {
    uid(): string;
    styleSourceId?(): number | undefined;
    baseId(): string | undefined;
    /**
     * Normalized component configuration relevant to CSS generation.
     */
    capabilities?(): StyleComponentCapabilities;
    states(): readonly StyleStateDescriptor[];
    /**
     * Parent styling context used for parent state selectors.
     *
     * Most readers only need to return `{ uid }`. If a test selector does not match the state
     * parent uid, the compiler falls back to its generated parent selector.
     */
    parentRef(): StyleParentRef | null | undefined;
    /**
     * Testing-only selector override.
     *
     * Production selectors are compiler-owned and generated from the source uid plus rendered
     * surface kind. Keep this out of real reader implementations unless a test needs a custom
     * selector fixture.
     */
    selector?(): string | null | undefined;
    /**
     * Whether this source should emit compiler-owned default declarations such as `padding: 0`.
     *
     * Real source definitions normally need those declarations so old inline defaults stay
     * preserved in generated CSS. Page-level library component root instances can return false so
     * an omitted property remains omitted and does not mask the shared library root definition.
     */
    emitDefaultDeclarations?(): boolean;
    /**
     * Generic visual/CSS style data, stored under `_state.style`.
     */
    style(): StylePropertyTreeReader;
    /**
     * Component-specific content data, stored under `content`.
     *
     * Most content is not CSS, but some component-owned properties such as `wwLayout` controls
     * produce CSS and are intentionally kept separate from generic style properties.
     */
    content(): StylePropertyTreeReader;
};

/**
 * Reader for a style class and its subclasses.
 */
export type StyleClassReader = {
    style(): StylePropertyTreeReader;
    content(): StylePropertyTreeReader;
    subClass(id: string): StyleClassReader | null;
};

/**
 * Source domain read by a declaration resolver.
 */
export type StylePropertyDomain = 'style' | 'content';

/**
 * Stateful responsive property tree for one source domain.
 */
export type StylePropertyTreeReader = {
    /**
     * Whether this property participates in state-specific source, class, and subclass slots.
     *
     * Omit this hook when every property in the domain is stateful.
     */
    supportsState?(property: string): boolean;
    state(name: string): StyleStateReader;
};

/**
 * Reader for one state of a style source or class.
 *
 * `base` is the compiler's always-present default state name.
 */
export type StyleStateReader = {
    /**
     * Style classes attached to this state, in cascade order.
     */
    classIds(): readonly string[];
    /**
     * Active subclasses per base class for this state.
     */
    subClassIds(classId: string): readonly string[];
    breakpoint(name: StyleBreakpointName): StyleBreakpointPropertyReader;
};

/**
 * Reader for one breakpoint inside one state.
 */
export type StyleBreakpointPropertyReader = {
    property(name: string): unknown;
    /**
     * Returns the whole Custom CSS value for this exact slot.
     *
     * Custom CSS is one legacy style property: an explicitly stored empty object replaces the
     * inherited object, so callers must be able to distinguish `{}` from an absent value.
     */
    customCss(): unknown;
    customCssProperty(name: string): unknown;
    customCssEntries(): readonly [property: string, value: unknown][];
};

/**
 * Output adapter used by the compiler.
 *
 * DOM adapters can mutate a style tag; publisher adapters can serialize CSS text.
 */
export type StyleSheetAdapter<TResult = unknown> = {
    insertRule(rule: StyleLayerStatementRule): StyleRuleAdapter;
    insertRule(rule: StyleLayerRule): StyleRuleContainerAdapter;
    insertRule(rule: StyleMediaRule): StyleRuleContainerAdapter;
    insertRule(rule: StyleStyleRule): StyleStyleRuleAdapter;
    insertRule(rule: StyleKeyframesRule): StyleRuleAdapter;
    /**
     * Root adapters can ignore this. Nested grouping adapters use it to release their whole rule
     * subtree.
     */
    dispose(): void;
    diagnostic?(diagnostic: StyleDiagnostic): void;
    /**
     * Receives a formula/dynamic value that was emitted as a CSS variable placeholder.
     *
     * Returning a cleanup lets reactive adapters unregister the variable when its target chunk
     * reruns or is removed.
     */
    dynamicVariable?(variable: StyleDynamicVariable): StyleScopeStop | void;
    /**
     * Associates a compiler-owned atomic class with the rendered source surface.
     *
     * Adapters that omit this capability receive the traditional source-selector declarations.
     */
    atomicClass?(assignment: StyleAtomicClassAssignment): StyleScopeStop | void;
    /**
     * Registers a typed custom property emitted for dynamic CSS variables.
     *
     * Static adapters serialize this as `@property`; DOM adapters insert it before generated layers.
     */
    registerProperty?(property: StyleRegisteredProperty): StyleScopeStop | void;
    /**
     * Groups synchronous stylesheet mutations so adapters can coalesce expensive cleanup work.
     */
    batch?(callback: () => void): void;
    result(): TResult;
};

export type StyleAtomicClassAssignment = {
    sourceUid: string;
    surfaceKind: StyleSurfaceKind;
    className: string;
};

/**
 * Mutable container returned for grouping rules such as generated groups and `@media`.
 */
export type StyleRuleContainerAdapter = {
    insertRule(rule: StyleLayerStatementRule): StyleRuleAdapter;
    insertRule(rule: StyleLayerRule): StyleRuleContainerAdapter;
    insertRule(rule: StyleMediaRule): StyleRuleContainerAdapter;
    insertRule(rule: StyleStyleRule): StyleStyleRuleAdapter;
    insertRule(rule: StyleKeyframesRule): StyleRuleAdapter;
    /**
     * Releases this grouping rule and all nested rules.
     */
    dispose(): void;
};

/**
 * Disposable handle returned for CSS rules that do not expose declarations.
 */
export type StyleRuleAdapter = {
    dispose(): void;
};

export type StyleDeclarationPriority = '' | 'important';

/**
 * Declaration surface exposed by one concrete selector rule.
 */
export type StyleRuleDeclarationAdapter = {
    /**
     * Sets one declaration on the rule.
     *
     * Returns `false` when the backing CSSOM ignores the mutation.
     */
    setProperty(cssProperty: string, cssValue: string, priority?: StyleDeclarationPriority): boolean;
    removeProperty(cssProperty: string): void;
};

/**
 * Mutable handle returned for one concrete selector rule.
 */
export type StyleStyleRuleAdapter = StyleRuleAdapter & {
    /**
     * Mirrors `CSSStyleRule.style`.
     */
    style: StyleRuleDeclarationAdapter;
};

/**
 * CSS rule identity.
 */
export type StyleRule = StyleLayerStatementRule | StyleLayerRule | StyleMediaRule | StyleStyleRule | StyleKeyframesRule;

/**
 * CSS `@layer a, b, c;` order statement.
 */
export type StyleLayerStatementRule = {
    kind: 'layer-statement';
    key: string;
    names: readonly string[];
};

/**
 * CSS cascade layer grouping rule.
 */
export type StyleLayerRule = {
    kind: 'layer';
    key: string;
    name: string;
};

/**
 * CSS `@media query { ... }` grouping rule.
 */
export type StyleMediaRule = {
    kind: 'media';
    key: string;
    query: string;
};

/**
 * CSS selector rule.
 */
export type StyleStyleRule = {
    kind: 'style';
    key: string;
    surface: StyleSurface;
    selector: string;
};

/**
 * CSS `@keyframes name { ... }` at-rule.
 *
 * The compiler cannot structurally model keyframe selectors, so it emits author-written keyframes as
 * a validated raw block (name already rewritten to the element-scoped `ww-keyframes-<uid>`).
 */
export type StyleKeyframesRule = {
    kind: 'keyframes';
    key: string;
    name: string;
    css: string;
};

/**
 * CSS Properties and Values API registration for compiler-owned dynamic variables.
 */
export type StyleRegisteredProperty = {
    name: string;
    syntax: '*';
    inherits: false;
};

/**
 * Internal marker for formula/dynamic values represented as CSS custom property placeholders.
 */
export const STYLE_DYNAMIC_VARIABLE_REFERENCE: unique symbol = Symbol('weweb.styleCompiler.dynamicVariableReference');

/**
 * One runtime condition controlling whether a generated CSS variable is present.
 *
 * `StyleDynamicVariableBase.condition` also accepts an array; every condition must match. This lets
 * formulas atomically gate declarations such as positioned offsets or section-root compatibility.
 */
export type StyleDynamicVariableCondition =
    | {
          value: unknown;
          allowedValues: readonly string[];
          /** Normalize the resolved condition value before comparing it with `allowedValues`. */
          valueNormalizer?: StyleCssValueNormalizer;
          /** New runtimes use exclusion semantics; `allowedValues` remains as an older-runtime fallback. */
          disallowedValues?: readonly string[];
          truthy?: never;
      }
    | {
          value: unknown;
          truthy: true;
          allowedValues?: never;
          disallowedValues?: never;
          valueNormalizer?: never;
      };

/**
 * Mutually exclusive runtime fallback strategies for one generated CSS variable.
 *
 * `when-empty` resolves one ordered secondary value. `when-all-empty` observes a related value
 * group after the primary value has resolved empty. Both preserve unresolved results so static CSS
 * can remain in control until every required formula is known.
 */
export type StyleDynamicVariableRuntimeFallback =
    | {
          type: 'when-empty';
          value: unknown;
          valueNormalizer?: StyleCssValueNormalizer;
      }
    | {
          type: 'when-all-empty';
          /** Secondary values which must also resolve empty. The primary value is evaluated once by the caller. */
          dependencies: readonly unknown[];
          value: unknown;
      };

/**
 * Formula/dynamic source value before the runtime knows the final emitted CSS property.
 */
export type StyleDynamicVariableBase = {
    name: string;
    surface: StyleSurface;
    group: StyleRuleGroup;
    sourceUid: string;
    domain: StylePropertyDomain;
    property: string;
    state: string;
    breakpoint: StyleBreakpointName;
    value: unknown;
    outputKey?: string;
    valueNormalizer?: StyleCssValueNormalizer;
    /** CSS property grammar used to validate this value before writing its runtime custom property. */
    validationProperty?: string;
    /** Do not write the runtime variable when its source resolves to `undefined`. */
    omitWhenUndefined?: boolean;
    /** A single runtime gate, or several gates combined with AND semantics. */
    condition?: StyleDynamicVariableCondition | readonly StyleDynamicVariableCondition[];
    runtimeFallback?: StyleDynamicVariableRuntimeFallback;
};

/**
 * Formula/dynamic source value represented as a CSS custom property placeholder.
 */
type StyleDynamicVariableOutput = StyleDynamicVariableBase & {
    cssProperty: string;
    selector: string;
    /** The generated declaration consists only of this variable and can be replaced atomically at runtime. */
    directDeclaration?: boolean;
};

export type StyleDynamicVariable =
    | (StyleDynamicVariableOutput & {
          kind?: undefined;
          keyframesName?: never;
      })
    | (StyleDynamicVariableOutput & {
          /** Runtime-only at-rule output that also writes this variable as the instance animation name. */
          kind: 'keyframes';
          /** Compiler-scoped base name; the browser runtime appends the mounted component id. */
          keyframesName: string;
      });

/**
 * Placeholder value returned by compiler reads for formula/dynamic source values.
 */
export type StyleDynamicVariableReference = {
    readonly [STYLE_DYNAMIC_VARIABLE_REFERENCE]: true;
    readonly name: string;
    readonly cssText: string;
    readonly variable: StyleDynamicVariableBase;
    withCssFallback(value: unknown): StyleDynamicVariableReference;
    withCssFallbackIfMissing(value: unknown): StyleDynamicVariableReference;
    asRuntimeKeyframes(keyframesName: string): StyleDynamicVariableReference;
    toCssText(cssProperty?: string): string;
    register(options?: {
        cssProperty?: string;
        validationProperty?: string;
        selector?: string;
        directDeclaration?: boolean;
    }): void;
    toString(): string;
    [Symbol.toPrimitive](): string;
};

/**
 * Exact CSS text produced when a dynamic reference is coerced inside a larger string expression.
 */
export type StyleStringifiedDynamicVariableReference = {
    reference: StyleDynamicVariableReference;
    cssText: string;
};

/**
 * Non-fatal compiler issue reported by adapters.
 */
export type StyleDiagnostic = {
    code: string;
    surface?: StyleSurface;
    selector?: string;
    property?: string;
    message: string;
};

/**
 * Shared compiler interface.
 */
export type StyleCompiler = {
    compileStylesheet<TResult>(input: StyleCompilerInput<TResult>): StyleCompilerRun<TResult>;
};

/**
 * Loose style object shape used when aggregating grouped CSS properties.
 */
export type CssStyleRecord = Record<string, unknown>;
