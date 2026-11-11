import {
    getStyleBreakpointRangeMediaQuery,
    STYLE_BREAKPOINTS,
    type StyleBreakpointDefinition,
    type StyleBreakpointName,
} from './breakpoints';
import {
    createCustomCssDeclaration,
    createKeyframesRule,
    getDeclarationResolvers,
    type CompiledStyleDeclaration,
    type CompiledStyleRuleTarget,
    type DeclarationScope,
} from './declarations';
import {
    registerCssDeclarationDynamicReferences,
    serializeCssDeclarationValue,
    serializeCssProperty,
    splitLegacyCssPriority,
} from './serialization';
import { createStyleEffectScope } from './scope';
import { getStateRuleSelectors, getUniqueStates } from './states';
import {
    createStyleTargetDescriptors,
    createStyleTargetSurfaces,
    readStyleTargetSource,
    type StyleSourceReader,
    type StyleTargetDescriptor,
} from './targets';
import {
    collectStringifiedDynamicCssVariableReferences,
    createStyleSlotContext,
    isStyleDynamicVariableReference,
    resolveCustomCssProperties,
    resolveRawStyleProperty,
} from './values';
import { createAtomicStyleClassName } from './atomic';
import type {
    StyleCompiler,
    StyleAtomicClassAssignment,
    StyleCompilerInput,
    StyleDeclarationPriority,
    StyleDynamicVariable,
    StyleElementReader,
    StyleLibraryLayer,
    StyleStringifiedDynamicVariableReference,
    StylePropertyDomain,
    StyleRegisteredProperty,
    StyleRule,
    StyleRuleGroup,
    StyleRuleAdapter,
    StyleRuleContainerAdapter,
    StyleScopeDispose,
    StyleScopeStop,
    StyleStyleRule,
    StyleStyleRuleAdapter,
    StyleSurface,
    StyleRuntime,
    StyleStateDescriptor,
    StylePropertyTreeReader,
    StyleStateReader,
    StyleBreakpointPropertyReader,
} from './types';
import {
    STATIC_STYLE_RUNTIME,
    STYLE_LAYOUT_OVERRIDE_LAYER,
    STYLE_LIBRARY_LAYER_ORDER,
    STYLE_RULE_GROUP_LAYERS,
    STYLE_RULE_GROUPS,
} from './types';

const ORDER_SENSITIVE_TARGET_GROUPS: readonly StyleRuleGroup[] = ['library'];
const RENDERLESS_LAYOUT_STYLE_OVERRIDE_PROPERTIES = ['display'] as const;
const STYLE_DECLARATION_LAYER_ORDER = ['normal', 'custom'] as const;
type StyleDeclarationLayer = (typeof STYLE_DECLARATION_LAYER_ORDER)[number];
type StyleRuleEmissionLayer = StyleDeclarationLayer | 'layout-override';
type StyleSurfaceLayerContainerKey = Exclude<StyleRuleGroup, 'library'> | `library:${StyleLibraryLayer}`;
type StyleDeclarationLayerContainers = Record<StyleDeclarationLayer, StyleRuleContainerAdapter> & {
    atomic?: StyleRuleContainerAdapter;
};
type AtomicRuleRegistration = {
    className: string;
    canonicalDeclarations: string;
    references: number;
    rule: StyleRuleAdapter;
};
type AtomicCompiledDeclaration = {
    property: string;
    value: string;
    priority: StyleDeclarationPriority;
};
type StyleCompilerLayerContainers = {
    declarations: Map<StyleSurfaceLayerContainerKey, StyleDeclarationLayerContainers>;
    layoutOverride: StyleRuleContainerAdapter;
    atomicRules: Map<string, AtomicRuleRegistration>;
};
type StyleTargetLayoutOverrideContainer = StyleRuleContainerAdapter & {
    reserve(): void;
};

/**
 * Creates the shared stylesheet compiler.
 *
 * The compiler walks the requested page sources, opens a reactive/static scope per level, and
 * delegates the actual CSS output to the stylesheet adapter. Publisher calls can use the static
 * scope; editor calls can inject Vue-backed scopes.
 */
export function createStyleCompiler(): StyleCompiler {
    return new StyleCompilerImpl();
}

class StyleCompilerImpl implements StyleCompiler {
    compileStylesheet<TResult>(input: StyleCompilerInput<TResult>) {
        const runtime = input.runtime || STATIC_STYLE_RUNTIME;
        const layerContainers =
            input.mode === 'runtime' ? createNoopLayerContainers() : createGeneratedLayerContainers(input.stylesheet);
        const targetStops = new Map<string, StyleScopeStop>();
        const targetOrders = new Map<StyleRuleGroup, string[]>();
        const stopRoot = createStyleEffectScope(runtime, () => {
            const reconcile = () =>
                this.reconcileStyleTargets(input, runtime, targetStops, targetOrders, layerContainers);

            if (input.stylesheet.batch) {
                input.stylesheet.batch(reconcile);
            } else {
                reconcile();
            }
        });

        return {
            result: input.stylesheet.result(),
            stop: createStylesheetStop(stopRoot, targetStops, input.stylesheet.batch),
        };
    }

    private reconcileStyleTargets(
        input: StyleCompilerInput,
        runtime: StyleRuntime,
        targetStops: Map<string, StyleScopeStop>,
        targetOrders: Map<StyleRuleGroup, string[]>,
        layerContainers: StyleCompilerLayerContainers
    ) {
        const targets = createStyleTargetDescriptors(input);
        const activeTargetKeys = new Set<string>();

        this.reconcileOrderSensitiveTargetGroups(targets, targetStops, targetOrders);

        for (const target of targets) {
            activeTargetKeys.add(target.key);
            if (targetStops.has(target.key)) continue;

            const layoutOverrideContainer = createTargetLayoutOverrideContainer(
                layerContainers.layoutOverride,
                target.key,
                runtime !== STATIC_STYLE_RUNTIME && target.group === 'library'
            );
            const stopTargetScope = createStyleEffectScope(runtime, onDispose => {
                this.compileTarget(input, onDispose, target, layerContainers, layoutOverrideContainer);
            });
            targetStops.set(target.key, () => {
                stopTargetScope();
                layoutOverrideContainer.dispose();
            });
        }

        for (const targetKey of [...targetStops.keys()]) {
            if (activeTargetKeys.has(targetKey)) continue;

            stopTarget(targetStops, targetKey);
        }
    }

    private reconcileOrderSensitiveTargetGroups(
        targets: StyleTargetDescriptor[],
        targetStops: Map<string, StyleScopeStop>,
        targetOrders: Map<StyleRuleGroup, string[]>
    ) {
        for (const group of ORDER_SENSITIVE_TARGET_GROUPS) {
            const targetKeys = targets.filter(target => target.group === group).map(target => target.key);
            const previousTargetKeys = targetOrders.get(group);

            targetOrders.set(group, targetKeys);
            if (!previousTargetKeys || stringArraysAreEqual(previousTargetKeys, targetKeys)) continue;

            const previousPositions = new Map(previousTargetKeys.map((targetKey, index) => [targetKey, index]));
            const reusableTargetKeys = new Set<string>();
            let previousPosition = -1;
            let rebuildSuffix = false;

            // Existing target chunks can stay mounted while their relative order is preserved.
            // Once a new or reordered target appears, the remaining suffix must be appended again
            // so its CSS keeps the requested cascade order.
            for (const targetKey of targetKeys) {
                if (rebuildSuffix) continue;

                const position = previousPositions.get(targetKey);
                if (position === undefined || position < previousPosition) {
                    rebuildSuffix = true;
                    continue;
                }

                reusableTargetKeys.add(targetKey);
                previousPosition = position;
            }

            for (const targetKey of [...targetStops.keys()]) {
                if (!targetKey.startsWith(`${group}:`) || reusableTargetKeys.has(targetKey)) continue;

                stopTarget(targetStops, targetKey);
            }
        }
    }

    private compileTarget(
        input: StyleCompilerInput,
        onDispose: StyleScopeDispose,
        target: StyleTargetDescriptor,
        layerContainers: StyleCompilerLayerContainers,
        layoutOverrideContainer: StyleTargetLayoutOverrideContainer
    ) {
        const sourceData = readStyleTargetSource(input.reader, target);
        if (!sourceData) return;
        const source = cacheSourceReads(sourceData);
        if (source.capabilities?.().inherits?.includes('ww-layout')) layoutOverrideContainer.reserve();

        const targetInput = createTargetScopedInput(input, onDispose);
        const ruleAdapters: StyleRuleAdapter[] = [];
        // Both element surfaces share the same source states. Resolve the fallback chain once so
        // provenance checks do not reread every state and breakpoint for each surface.
        const states = [{ id: 'base' }, ...getEffectiveSourceStates(targetInput, source)];

        onDispose(() => {
            for (let index = ruleAdapters.length - 1; index >= 0; index--) {
                ruleAdapters[index].dispose();
            }
        });

        for (const surface of createStyleTargetSurfaces(source, target)) {
            const surfaceLayerContainerKey = getStyleLayerContainerKey(surface);
            const surfaceDeclarationLayerContainers = layerContainers.declarations.get(surfaceLayerContainerKey);
            if (!surfaceDeclarationLayerContainers) continue;

            this.compileSurfaceRules(
                targetInput,
                ruleAdapters,
                source,
                surface,
                surfaceDeclarationLayerContainers,
                { normal: layoutOverrideContainer, custom: layoutOverrideContainer },
                target,
                states,
                layerContainers.atomicRules
            );
        }
    }

    private compileSurfaceRules(
        input: StyleCompilerInput,
        ruleAdapters: StyleRuleAdapter[],
        source: StyleSourceReader,
        surface: StyleSurface,
        layerContainers: StyleDeclarationLayerContainers,
        layoutOverrideLayerContainers: StyleDeclarationLayerContainers,
        target: StyleTargetDescriptor,
        states: readonly StyleStateDescriptor[],
        atomicRules: Map<string, AtomicRuleRegistration>
    ) {
        for (const state of states) {
            const selectorResult =
                state.id === 'base'
                    ? { selector: surface.selector, diagnostics: [] }
                    : getStateRuleSelectors({
                          state,
                          surface,
                          source,
                          mode: input.mode,
                      });

            for (const diagnostic of selectorResult.diagnostics) {
                input.stylesheet.diagnostic?.(diagnostic);
            }

            if (!selectorResult.selector) continue;

            // Rule insertion order inside a target chunk is the cascade order: base state first,
            // then configured states; inside each state, default/tablet/mobile breakpoints.
            for (const breakpoint of STYLE_BREAKPOINTS) {
                this.compileBreakpoint(
                    input,
                    ruleAdapters,
                    source,
                    surface,
                    layerContainers,
                    layoutOverrideLayerContainers,
                    state.id,
                    breakpoint,
                    selectorResult.selector,
                    getTargetEmitDefaultDeclarations(source, target),
                    atomicRules
                );
            }
        }
    }

    private compileBreakpoint(
        input: StyleCompilerInput,
        ruleAdapters: StyleRuleAdapter[],
        source: StyleSourceReader,
        surface: StyleSurface,
        layerContainers: StyleDeclarationLayerContainers,
        layoutOverrideLayerContainers: StyleDeclarationLayerContainers,
        state: string,
        breakpoint: StyleBreakpointDefinition,
        selector: string,
        emitDefaultDeclarations: boolean,
        atomicRules: Map<string, AtomicRuleRegistration>
    ) {
        const slots = new Map<StylePropertyDomain, ReturnType<typeof createStyleSlotContext>>();
        const scope: DeclarationScope = {
            surface,
            selector,
            input,
            source,
            state,
            breakpoint: breakpoint.name,
            emitDefaultDeclarations,
            slot(domain) {
                const cachedSlot = slots.get(domain);
                if (cachedSlot) return cachedSlot;

                const slot = createStyleSlotContext({
                    source,
                    state,
                    domain,
                });
                slots.set(domain, slot);
                return slot;
            },
        };
        const normalRules = createBreakpointRuleAccessors(layerContainers.normal, 'normal');
        const customRules = createBreakpointRuleAccessors(layerContainers.custom, 'custom');
        const layoutOverrideRules = createBreakpointRuleAccessors(
            layoutOverrideLayerContainers.normal,
            'layout-override'
        );
        const atomicDeclarationsByProperty = new Map<string, AtomicCompiledDeclaration>();

        for (const resolveDeclarations of getDeclarationResolvers(surface)) {
            const { result: declarations, references } = collectStringifiedDynamicCssVariableReferences(() =>
                resolveDeclarations(scope)
            );
            for (const declaration of declarations) {
                if (!declaration) continue;

                const rules = declaration.rule?.layer === 'layout-override' ? layoutOverrideRules : normalRules;
                this.applyDeclaration(
                    input,
                    rules.getRule,
                    declaration,
                    surface,
                    selector,
                    references,
                    {
                        state,
                        breakpoint: breakpoint.name,
                        container: layerContainers.atomic,
                        declarations: atomicDeclarationsByProperty,
                    }
                );
            }
        }

        if (atomicDeclarationsByProperty.size) {
            const atomicAssignment = registerAtomicDefaults({
                input,
                surface,
                sourceUid: source.uid(),
                declarations: [...atomicDeclarationsByProperty.values()],
                container: layerContainers.atomic,
                rules: atomicRules,
            });
            if (atomicAssignment) {
                ruleAdapters.push(atomicAssignment);
            } else {
                for (const declaration of atomicDeclarationsByProperty.values()) {
                    normalRules.getRule().style.setProperty(
                        declaration.property,
                        declaration.value,
                        declaration.priority
                    );
                }
            }
        }

        if (shouldCompileCustomCss(surface)) {
            this.compileCustomCssEntries(input, customRules.getRule, scope, surface, selector);
        }

        // The slot-scoped `@keyframes` block is emitted in the SAME slot/container as its matching
        // `animation-name` declaration (createAnimationNameDeclaration also delegates to
        // createKeyframesRule, so names stay in sync). `read()` is own-slot, so this only fires for the
        // exact state/breakpoint that defines the keyframes — going into the media container for
        // responsive slots. Runtime mode registers dynamic variables only, so it skips static CSS.
        if (input.mode !== 'runtime' && surface.kind === 'element') {
            const keyframes = createKeyframesRule(scope);
            if (keyframes) {
                const keyframesAdapter = normalRules.getRuleContainer().insertRule({
                    kind: 'keyframes',
                    key: `keyframes:${createStyleRuleKey({ surface, state, breakpoint })}`,
                    name: keyframes.name,
                    css: keyframes.css,
                });
                ruleAdapters.push(keyframesAdapter);
            }
        }

        function createBreakpointRuleAccessors(
            layerContainer: StyleRuleContainerAdapter,
            declarationLayer: StyleRuleEmissionLayer
        ) {
            const rules = new Map<string, StyleStyleRuleAdapter>();
            const mediaContainers = new Map<string, StyleRuleContainerAdapter>();
            const getRuleContainer = (target?: CompiledStyleRuleTarget) => {
                const mediaQuery = target?.mediaQuery || breakpoint.mediaQuery;
                if (!mediaQuery) return layerContainer;

                const cachedContainer = mediaContainers.get(mediaQuery);
                if (cachedContainer) return cachedContainer;

                const mediaContainer = layerContainer.insertRule({
                    kind: 'media',
                    key: `media:${declarationLayer}:${createStyleRuleKey({
                        surface,
                        state,
                        breakpoint,
                    })}:${escapeRuleKeyPart(mediaQuery)}`,
                    query: mediaQuery,
                });
                mediaContainers.set(mediaQuery, mediaContainer);
                ruleAdapters.push(mediaContainer);
                return mediaContainer;
            };
            const getRule = (target?: CompiledStyleRuleTarget) => {
                const targetKey = target?.keySuffix || '';
                const cachedRule = rules.get(targetKey);
                if (cachedRule) return cachedRule;

                const rule = getRuleContainer(target).insertRule(
                    createStyleRule({
                        surface,
                        state,
                        breakpoint,
                        selector,
                        target,
                    })
                );
                rules.set(targetKey, rule);
                ruleAdapters.push(rule);
                return rule;
            };

            return { getRule, getRuleContainer };
        }
    }

    private compileCustomCssEntries(
        input: StyleCompilerInput,
        getRule: (target?: CompiledStyleRuleTarget) => StyleStyleRuleAdapter,
        scope: DeclarationScope,
        surface: StyleSurface,
        selector: string
    ) {
        // Legacy Custom CSS is one whole responsive property. Mutually-exclusive ranges let an
        // explicit `{}` or partial map replace the inherited map without leaking desktop keys.
        const { result: customCss, references } = collectStringifiedDynamicCssVariableReferences(() =>
            resolveCustomCssProperties({
                input,
                surface,
                source: scope.source,
                state: scope.state,
                breakpoint: scope.breakpoint,
                slot: scope.slot('style'),
            })
        );
        const rule: CompiledStyleRuleTarget | undefined = customCss.useBreakpointRange
            ? {
                  keySuffix: 'custom-css-breakpoint-range',
                  selector,
                  mediaQuery: getStyleBreakpointRangeMediaQuery(scope.breakpoint),
              }
            : undefined;

        for (const { property, value } of customCss.properties) {
            const declaration = createCustomCssDeclaration({
                property,
                value,
                rule,
            });
            if (declaration) {
                this.applyDeclaration(input, getRule, declaration, surface, selector, references);
            }
        }
    }

    private applyDeclaration(
        input: StyleCompilerInput,
        getRule: (target?: CompiledStyleRuleTarget) => StyleStyleRuleAdapter,
        declaration: CompiledStyleDeclaration,
        surface: StyleSurface,
        selector: string,
        dynamicReferences: readonly StyleStringifiedDynamicVariableReference[] = [],
        atomicContext?: {
            state: string;
            breakpoint: StyleBreakpointName;
            container?: StyleRuleContainerAdapter;
            declarations: Map<string, AtomicCompiledDeclaration>;
        }
    ) {
        const cssProperty = serializeCssProperty(declaration.property);
        const ruleTarget = declaration.rule;
        const ruleSelector = ruleTarget?.selector || selector;

        if (
            input.mode === 'runtime' &&
            !dynamicReferences.length &&
            !isStyleDynamicVariableReference(declaration.value)
        ) {
            return;
        }

        const cssValue = cssProperty ? serializeCssDeclarationValue(cssProperty, declaration.value) : undefined;

        // Unsupported WeWeb value types cannot be sent to CSSOM. CSS grammar validity is decided by
        // the stylesheet adapter below.
        if (!cssProperty || !cssValue) {
            addSerializationDiagnostic(input, surface, ruleSelector, declaration, cssProperty ? 'value' : 'property');
            return;
        }

        if (input.mode === 'runtime') {
            registerCssDeclarationDynamicReferences(cssProperty, declaration.value, cssValue, {
                selector: ruleSelector,
                dynamicReferences,
            });
            return;
        }

        const { value, priority } = splitLegacyCssPriority(cssProperty, cssValue);
        if (
            atomicContext &&
            shouldEmitAtomicDefault({
                input,
                declaration,
                surface,
                dynamicReferences,
                priority,
                state: atomicContext.state,
                breakpoint: atomicContext.breakpoint,
                container: atomicContext.container,
            })
        ) {
            atomicContext.declarations.set(cssProperty, { property: cssProperty, value, priority });
            return;
        }

        const accepted = getRule(ruleTarget).style.setProperty(cssProperty, value, priority);
        if (accepted === false) {
            addSerializationDiagnostic(
                input,
                surface,
                ruleSelector,
                declaration,
                isCssPropertyName(cssProperty) ? 'value' : 'property'
            );
            return;
        }

        registerCssDeclarationDynamicReferences(cssProperty, declaration.value, value, {
            selector: ruleSelector,
            dynamicReferences,
        });
    }
}

function shouldEmitAtomicDefault({
    input,
    declaration,
    surface,
    dynamicReferences,
    priority,
    state,
    breakpoint,
    container,
}: {
    input: StyleCompilerInput;
    declaration: CompiledStyleDeclaration;
    surface: StyleSurface;
    dynamicReferences: readonly StyleStringifiedDynamicVariableReference[];
    priority: StyleDeclarationPriority;
    state: string;
    breakpoint: StyleBreakpointName;
    container?: StyleRuleContainerAdapter;
}) {
    return (
        !!input.stylesheet.atomicClass &&
        !!container &&
        declaration.isDefault === true &&
        !declaration.rule &&
        !dynamicReferences.length &&
        priority === '' &&
        state === 'base' &&
        breakpoint === 'default' &&
        surface.group !== 'library' &&
        surface.kind !== 'element-layout' &&
        surface.kind !== 'section-layout'
    );
}

function registerAtomicDefaults({
    input,
    surface,
    sourceUid,
    declarations,
    container,
    rules,
}: {
    input: StyleCompilerInput;
    surface: StyleSurface;
    sourceUid: string;
    declarations: readonly AtomicCompiledDeclaration[];
    container?: StyleRuleContainerAdapter;
    rules: Map<string, AtomicRuleRegistration>;
}): StyleRuleAdapter | null {
    if (!container || !input.stylesheet.atomicClass) return null;

    // Keep compiler declaration order: shorthand/longhand pairs are order-sensitive.
    const orderedDeclarations = [...declarations];
    const canonicalDeclarations = orderedDeclarations
        .map(({ property, value, priority }) => `${property}\u001f${value}\u001f${priority}`)
        .join('\u001e');
    const identity = `${surface.group}\u001d${canonicalDeclarations}`;
    let registration = rules.get(identity);

    if (!registration) {
        const className = createAtomicStyleClassName({
            group: surface.group,
            declarations: orderedDeclarations,
        });
        for (const existing of rules.values()) {
            if (existing.className === className && existing.canonicalDeclarations !== canonicalDeclarations) {
                return null;
            }
        }
        const rule = container.insertRule({
            kind: 'style',
            key: `atomic:${className}`,
            surface,
            selector: `.${className}`,
        });
        for (const { property, value, priority } of orderedDeclarations) {
            if (rule.style.setProperty(property, value, priority) === false) {
                rule.dispose();
                return null;
            }
        }

        registration = { className, canonicalDeclarations, references: 0, rule };
        rules.set(identity, registration);
    }

    registration.references++;
    const assignment: StyleAtomicClassAssignment = {
        sourceUid,
        surfaceKind: surface.kind,
        className: registration.className,
    };
    const disposeAssignment = input.stylesheet.atomicClass(assignment) || (() => {});
    let active = true;

    return {
        dispose() {
            if (!active) return;

            active = false;
            disposeAssignment();
            if (!registration) return;

            registration.references--;
            if (registration.references > 0) return;

            registration.rule.dispose();
            rules.delete(identity);
        },
    };
}

/**
 * Includes concrete-root states when compiling a renderless library instance.
 *
 * Instance style overrides are emitted in a higher cascade layer. Layout declarations that combine
 * those overrides with concrete-root layout state must therefore be recomputed for every root state,
 * not only for states stored on the renderless instance itself.
 */
function getEffectiveSourceStates(input: StyleCompilerInput, source: StyleSourceReader) {
    const sourceStates = getUniqueStates(source.states());
    if (!hasRenderlessLayoutStyleOverride(input, source, sourceStates)) return sourceStates;

    const states = [...sourceStates];
    const visitedSourceUids = new Set([source.uid()]);
    let currentSource = isRenderlessLibraryInstanceSource(source)
        ? source.effectiveFallbackSource?.() || null
        : null;

    while (currentSource && !visitedSourceUids.has(currentSource.uid())) {
        visitedSourceUids.add(currentSource.uid());
        states.push(...currentSource.states());
        currentSource = isRenderlessLibraryInstanceSource(currentSource)
            ? currentSource.effectiveFallbackSource?.() || null
            : null;
    }

    return getUniqueStates(states);
}

function hasRenderlessLayoutStyleOverride(
    input: StyleCompilerInput,
    source: StyleSourceReader,
    states: readonly { id: string }[]
) {
    if (!isRenderlessLibraryInstanceSource(source)) return false;

    for (const state of [{ id: 'base' }, ...states]) {
        for (const breakpoint of STYLE_BREAKPOINTS) {
            for (const property of RENDERLESS_LAYOUT_STYLE_OVERRIDE_PROPERTIES) {
                const value = resolveRawStyleProperty({
                    input,
                    source,
                    property,
                    state: state.id,
                    breakpoint: breakpoint.name,
                });
                if (value !== undefined) return true;
            }
        }
    }

    return false;
}

function isRenderlessLibraryInstanceSource(source: StyleSourceReader): source is StyleElementReader {
    return source.kind() === 'element' && !!(source as StyleElementReader).isLibraryComponentInstance?.();
}

/**
 * Declaration families and surfaces repeatedly read the same source slots. Share those reads
 * only within this target effect. The first read still subscribes to reactive dependencies;
 * rerunning the effect creates fresh caches, including for previously absent properties.
 */
function cacheSourceReads(source: StyleSourceReader): StyleSourceReader {
    const readCapabilities = source.capabilities;
    let style: StylePropertyTreeReader | undefined;
    let content: StylePropertyTreeReader | undefined;
    let hasCachedCapabilities = false;
    let cachedCapabilities: ReturnType<NonNullable<StyleSourceReader['capabilities']>> | undefined;
    return {
        ...source,
        style() {
            return (style ||= cachePropertyTreeReads(source.style()));
        },
        ...(source.content && {
            content() {
                return (content ||= cachePropertyTreeReads(source.content!()));
            },
        }),
        capabilities() {
            if (!hasCachedCapabilities) {
                cachedCapabilities = readCapabilities?.call(source);
                hasCachedCapabilities = true;
            }
            return cachedCapabilities || {};
        },
    };
}

function cachePropertyTreeReads(tree: StylePropertyTreeReader): StylePropertyTreeReader {
    const states = new Map<string, StyleStateReader>();
    return {
        ...tree,
        state(name) {
            const cached = states.get(name);
            if (cached) return cached;
            const state = tree.state(name);
            const breakpoints = new Map<StyleBreakpointName, StyleBreakpointPropertyReader>();
            const reader: StyleStateReader = {
                ...state,
                breakpoint(name) {
                    const cached = breakpoints.get(name);
                    if (cached) return cached;
                    const slot = state.breakpoint(name);
                    const properties = new Map<string, unknown>();
                    const reader: StyleBreakpointPropertyReader = {
                        ...slot,
                        property(name) {
                            if (!properties.has(name)) properties.set(name, slot.property(name));
                            return properties.get(name);
                        },
                    };
                    breakpoints.set(name, reader);
                    return reader;
                },
            };
            states.set(name, reader);
            return reader;
        },
    };
}

/**
 * Creates the fixed generated layer tree once per compiler run.
 */
function createGeneratedLayerContainers(stylesheet: StyleCompilerInput['stylesheet']) {
    const declarationLayerContainers = new Map<StyleSurfaceLayerContainerKey, StyleDeclarationLayerContainers>();
    for (const group of STYLE_RULE_GROUPS) {
        const groupLayer = stylesheet.insertRule({
            kind: 'layer',
            key: group,
            name: STYLE_RULE_GROUP_LAYERS[group],
        });
        if (group !== 'library') {
            declarationLayerContainers.set(
                group,
                createDeclarationLayerContainers(groupLayer, group, !!stylesheet.atomicClass)
            );
            continue;
        }

        groupLayer.insertRule({
            kind: 'layer-statement',
            key: 'library-layer-order',
            names: STYLE_LIBRARY_LAYER_ORDER,
        });
        for (const libraryLayer of STYLE_LIBRARY_LAYER_ORDER) {
            const libraryLayerContainer = groupLayer.insertRule({
                kind: 'layer',
                key: libraryLayer,
                name: libraryLayer,
            });
            declarationLayerContainers.set(
                `library:${libraryLayer}`,
                createDeclarationLayerContainers(libraryLayerContainer, `library:${libraryLayer}`)
            );
        }
    }

    const layoutOverrideLayer = stylesheet.insertRule({
        kind: 'layer',
        key: 'layout-override',
        name: STYLE_LAYOUT_OVERRIDE_LAYER,
    });
    return { declarations: declarationLayerContainers, layoutOverride: layoutOverrideLayer, atomicRules: new Map() };
}

function createDeclarationLayerContainers(
    parent: StyleRuleContainerAdapter,
    keyPrefix: string,
    supportsAtomicClasses = false
): StyleDeclarationLayerContainers {
    parent.insertRule({
        kind: 'layer-statement',
        key: `${keyPrefix}:declaration-layer-order`,
        names: STYLE_DECLARATION_LAYER_ORDER,
    });

    const normal = parent.insertRule({
        kind: 'layer',
        key: `${keyPrefix}:normal`,
        name: 'normal',
    });
    let orderedNormal = normal;
    let atomic: StyleRuleContainerAdapter | undefined;
    if (supportsAtomicClasses) {
        normal.insertRule({
            kind: 'layer-statement',
            key: `${keyPrefix}:normal:atomic-layer-order`,
            names: ['atomic', 'ordered'],
        });
        atomic = normal.insertRule({
            kind: 'layer',
            key: `${keyPrefix}:normal:atomic`,
            name: 'atomic',
        });
        orderedNormal = normal.insertRule({
            kind: 'layer',
            key: `${keyPrefix}:normal:ordered`,
            name: 'ordered',
        });
    }

    return {
        normal: orderedNormal,
        custom: parent.insertRule({
            kind: 'layer',
            key: `${keyPrefix}:custom`,
            name: 'custom',
        }),
        atomic,
    };
}

/**
 * Runtime mode only needs declaration serialization to register dynamic variable metadata.
 * Static generated rules are intentionally discarded.
 */
function createNoopLayerContainers() {
    const declarationLayerContainers = new Map<StyleSurfaceLayerContainerKey, StyleDeclarationLayerContainers>();
    const container = createNoopRuleContainerAdapter();
    const containers = { normal: container, custom: container };
    for (const group of STYLE_RULE_GROUPS) {
        if (group !== 'library') {
            declarationLayerContainers.set(group, containers);
            continue;
        }

        for (const libraryLayer of STYLE_LIBRARY_LAYER_ORDER) {
            declarationLayerContainers.set(`library:${libraryLayer}`, containers);
        }
    }

    return { declarations: declarationLayerContainers, layoutOverride: container, atomicRules: new Map() };
}

/**
 * Gives layout-capable reactive library targets stable source-order slots inside the flat override layer.
 *
 * Reactive target reruns clear and rebuild the wrapper's children without moving the wrapper itself;
 * structural target changes dispose the whole slot through the target stop registered by the
 * reconciler. Static compilation and non-overlapping page targets write directly into the layer and
 * use a non-owning adapter so stopping one target never disposes the shared layer.
 */
function createTargetLayoutOverrideContainer(
    parent: StyleRuleContainerAdapter,
    targetKey: string,
    preserveReactiveOrder: boolean
) {
    let targetContainer: StyleRuleContainerAdapter | undefined;
    const getTargetContainer = () => {
        targetContainer ||= parent.insertRule({
            kind: 'media',
            key: `layout-override-target:${targetKey}`,
            query: '@media all',
        });
        return targetContainer;
    };
    const getRuleContainer = () => (preserveReactiveOrder ? getTargetContainer() : parent);

    function insertRule(rule: Extract<StyleRule, { kind: 'layer-statement' }>): StyleRuleAdapter;
    function insertRule(rule: Extract<StyleRule, { kind: 'layer' }>): StyleRuleContainerAdapter;
    function insertRule(rule: Extract<StyleRule, { kind: 'media' }>): StyleRuleContainerAdapter;
    function insertRule(rule: Extract<StyleRule, { kind: 'style' }>): StyleStyleRuleAdapter;
    function insertRule(rule: Extract<StyleRule, { kind: 'keyframes' }>): StyleRuleAdapter;
    function insertRule(rule: StyleRule) {
        switch (rule.kind) {
            case 'layer-statement':
                return getRuleContainer().insertRule(rule);
            case 'layer':
                return getRuleContainer().insertRule(rule);
            case 'media':
                return getRuleContainer().insertRule(rule);
            case 'style':
                return getRuleContainer().insertRule(rule);
            case 'keyframes':
                return getRuleContainer().insertRule(rule);
        }
    }

    return {
        insertRule,
        reserve() {
            if (preserveReactiveOrder) getTargetContainer();
        },
        dispose() {
            targetContainer?.dispose();
            targetContainer = undefined;
        },
    } satisfies StyleTargetLayoutOverrideContainer;
}

function getStyleLayerContainerKey(surface: StyleSurface): StyleSurfaceLayerContainerKey {
    if (surface.group !== 'library') return surface.group;

    return `library:${surface.libraryLayer || 'definition'}`;
}

function createNoopRuleContainerAdapter(): StyleRuleContainerAdapter {
    const ruleAdapter = {
        dispose() {},
    } satisfies StyleRuleAdapter;
    const styleRuleAdapter = {
        ...ruleAdapter,
        style: {
            setProperty() {
                return false;
            },
            removeProperty() {},
        },
    } satisfies StyleStyleRuleAdapter;

    const containerAdapter = {
        insertRule(rule: StyleRule) {
            return rule.kind === 'style' ? styleRuleAdapter : containerAdapter;
        },
        dispose() {},
    } satisfies StyleRuleContainerAdapter;

    return containerAdapter;
}

/**
 * Wraps `dynamicVariable()` so variable registrations are owned by the target chunk that emitted
 * them. When that chunk reruns or disappears, the editor runtime can clear stale CSS-var writers.
 */
function createTargetScopedInput(input: StyleCompilerInput, onDispose: StyleScopeDispose): StyleCompilerInput {
    const registerDynamicVariable = input.stylesheet.dynamicVariable;
    const registerProperty = input.mode === 'runtime' ? undefined : input.stylesheet.registerProperty;
    if (!registerDynamicVariable && !registerProperty) return input;

    const dynamicVariableKeys = new Set<string>();
    const dynamicVariableCleanups: StyleScopeStop[] = [];
    const registeredPropertyKeys = new Set<string>();
    const registeredPropertyCleanups: StyleScopeStop[] = [];
    onDispose(() => {
        for (let index = dynamicVariableCleanups.length - 1; index >= 0; index--) {
            dynamicVariableCleanups[index]();
        }
        for (let index = registeredPropertyCleanups.length - 1; index >= 0; index--) {
            registeredPropertyCleanups[index]();
        }
        dynamicVariableKeys.clear();
        dynamicVariableCleanups.length = 0;
        registeredPropertyKeys.clear();
        registeredPropertyCleanups.length = 0;
    });

    const stylesheet: StyleCompilerInput['stylesheet'] = {
        ...input.stylesheet,
        registerProperty: registerProperty
            ? (property: StyleRegisteredProperty) => {
                  const key = createRegisteredPropertyKey(property);
                  if (registeredPropertyKeys.has(key)) return;

                  registeredPropertyKeys.add(key);
                  const cleanup = registerProperty.call(input.stylesheet, property);
                  if (cleanup) registeredPropertyCleanups.push(cleanup);
              }
            : undefined,
        dynamicVariable(variable) {
            const key = createDynamicVariableKey(variable);
            if (dynamicVariableKeys.has(key)) return;

            dynamicVariableKeys.add(key);
            const cleanup = registerDynamicVariable?.call(input.stylesheet, variable);
            if (cleanup) dynamicVariableCleanups.push(cleanup);
        },
    };

    return {
        ...input,
        stylesheet,
    };
}

function createRegisteredPropertyKey(property: StyleRegisteredProperty) {
    return property.name;
}

function createDynamicVariableKey(variable: StyleDynamicVariable) {
    return [
        variable.group,
        variable.surface.libraryLayer || '',
        variable.sourceUid,
        variable.surface.key,
        variable.domain,
        variable.property,
        variable.state,
        variable.breakpoint,
        variable.name,
        variable.kind || '',
        variable.keyframesName || '',
        variable.outputKey || '',
        variable.omitWhenUndefined ? 'omit-undefined' : '',
        stringifyDynamicVariableValueNormalizer(variable.valueNormalizer),
        variable.validationProperty,
        variable.selector,
        variable.cssProperty,
    ].join('\u001f');
}

function stringifyDynamicVariableValueNormalizer(valueNormalizer: StyleDynamicVariable['valueNormalizer']) {
    if (!valueNormalizer) return '';

    return JSON.stringify(valueNormalizer);
}

/**
 * Creates an idempotent stop for the root list watcher and all live target scopes.
 */
function createStylesheetStop(
    stopRoot: StyleScopeStop,
    targetStops: Map<string, StyleScopeStop>,
    batch?: (callback: () => void) => void
) {
    let stopped = false;

    return () => {
        if (stopped) return;

        stopped = true;
        const stop = () => {
            stopRoot();
            stopTargets(targetStops);
        };

        if (batch) {
            batch(stop);
        } else {
            stop();
        }
    };
}

/**
 * Stops one target scope and removes it from the registry.
 */
function stopTarget(targetStops: Map<string, StyleScopeStop>, targetKey: string) {
    const stop = targetStops.get(targetKey);
    if (!stop) return;

    targetStops.delete(targetKey);
    stop();
}

/**
 * Stops all target scopes in reverse creation order.
 */
function stopTargets(targetStops: Map<string, StyleScopeStop>) {
    const stops = [...targetStops.values()].reverse();
    targetStops.clear();

    for (const stop of stops) {
        stop();
    }
}

function stringArraysAreEqual(left: readonly string[], right: readonly string[]) {
    return left.length === right.length && left.every((value, index) => value === right[index]);
}

/**
 * Creates the rule identity used by adapters to materialize CSS.
 */
function createStyleRule({
    surface,
    state,
    breakpoint,
    selector,
    target,
}: {
    surface: StyleSurface;
    state: string;
    breakpoint: StyleBreakpointDefinition;
    selector: string;
    target?: CompiledStyleRuleTarget;
}): StyleStyleRule {
    const baseKey = createStyleRuleKey({ surface, state, breakpoint });

    return {
        kind: 'style',
        key: target ? `${baseKey}:target:${escapeRuleKeyPart(target.keySuffix)}` : baseKey,
        surface,
        selector: target?.selector || selector,
    };
}

/**
 * Creates a stable key for one surface/state/breakpoint rule.
 */
function createStyleRuleKey({
    surface,
    state,
    breakpoint,
}: {
    surface: StyleSurface;
    state: string;
    breakpoint: StyleBreakpointDefinition;
}) {
    return `${surface.key}:state:${escapeRuleKeyPart(state)}:breakpoint:${escapeRuleKeyPart(breakpoint.name)}`;
}

/**
 * Reports a declaration that could not be represented or was ignored by the backing CSSOM.
 */
function addSerializationDiagnostic(
    input: StyleCompilerInput,
    surface: StyleSurface,
    selector: string,
    declaration: CompiledStyleDeclaration,
    reason: 'property' | 'value'
) {
    if (declaration.value === undefined || declaration.value === null || declaration.value === '') return;

    input.stylesheet.diagnostic?.({
        code: reason === 'property' ? 'css-property-fallback' : 'css-value-fallback',
        surface,
        selector,
        property: declaration.property,
        message:
            reason === 'property'
                ? `Could not safely serialize CSS property ${declaration.property}.`
                : `Could not safely serialize ${declaration.property}.`,
    });
}

/** Used only to select a useful diagnostic; CSSOM remains the validity authority. */
function isCssPropertyName(property: string) {
    if (property.startsWith('--')) return /^--[-_a-zA-Z0-9]+$/.test(property);
    return /^-?[_a-zA-Z][-_a-zA-Z0-9]*$/.test(property);
}

/**
 * Escapes rule-key segments so state and breakpoint names cannot collide.
 */
function escapeRuleKeyPart(value: string) {
    return encodeURIComponent(value);
}

function shouldCompileCustomCss(surface: StyleSurface) {
    // Legacy sections applied Custom CSS to `containerStyle` only. The inner section component had
    // its own structured `elementStyle`, so emitting the same Custom CSS on both surfaces paints
    // non-inherited effects such as backgrounds and shadows twice.
    return surface.kind === 'element' || surface.kind === 'section-container';
}

function getTargetEmitDefaultDeclarations(source: StyleSourceReader, target: StyleTargetDescriptor) {
    if (target.emitDefaultDeclarations !== undefined) return target.emitDefaultDeclarations;

    return source.emitDefaultDeclarations?.() ?? true;
}
