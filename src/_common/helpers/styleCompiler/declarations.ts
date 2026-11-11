import { getCompiledBackgroundDeclarations, getCompiledBackgroundShorthand } from './background';
import { rewriteAnimationKeyframes } from './keyframes';
import {
    createAuthoredStyleDeclaration,
    createDeclaration,
    readDisplayValue as readDisplay,
    readEffectiveStyleValue as readEffective,
    readStyleValue as read,
    shouldEmitDefaultDeclaration,
    type CompiledStyleDeclaration,
    type CompiledStyleRuleTarget,
    type DeclarationScope,
    type StyleDeclarationResolver,
} from './declaration';
import { createLayoutDeclarations } from './layoutDeclarations';
import {
    DEFAULT_DISPLAY_VALUES,
    getAllowedDisplayValues,
    getStyleComponentCapabilities,
    hasConfiguredDisplayAllowedValues,
    isInheritedStylePropertyExcluded,
    isStylePropertyDeclarationDisabled,
    normalizeDisplayValue,
    sourceInheritsText,
} from './capabilities';
import {
    createConditionalDynamicCssVariableReference,
    createWhenAllEmptyDynamicCssVariableReference,
    createWhenEmptyDynamicCssVariableReference,
    isDynamicCssVariableReference,
    isDynamicValue,
    isStyleDynamicVariableReference,
    normalizeStyleRuntimeValue,
    resolveMappedStyleProperty,
    resolveRawStyleProperty,
    resolveStylePropertyOrigin,
    type StylePropertyOrigin,
} from './values';
import type {
    CssStyleRecord,
    StyleCssOutput,
    StyleCssPropertyProxy,
    StyleCssValueMap,
    StyleCssValueNormalizer,
    StyleDynamicVariableReference,
    StyleElementReader,
    StylePropertyDomain,
    StyleSurface,
} from './types';

export type {
    CompiledStyleDeclaration,
    CompiledStyleRuleTarget,
    DeclarationScope,
    StyleDeclarationResolver,
} from './declaration';

/**
 * Border longhands reset by the `border` shorthand.
 */
const BORDER_LONGHAND_PROPERTIES = ['borderTop', 'borderBottom', 'borderLeft', 'borderRight'];
const ELEMENT_OTHER_PROPERTIES = [
    'boxShadow',
    'opacity',
    'transition',
    'transform',
    'animationDuration',
    'animationTimingFunction',
    'animationDelay',
    'animationFillMode',
];
const TEXT_FONT_LONGHAND_PROPERTIES = [
    ['_ww-text_fontSize', 'fontSize'],
    ['_ww-text_fontFamily', 'fontFamily'],
    ['_ww-text_lineHeight', 'lineHeight'],
    ['_ww-text_fontWeight', 'fontWeight'],
    ['_ww-text_fontStyle', 'fontStyle'],
] as const;
const LEGACY_DEFAULT_FONT_FAMILY = 'var(--ww-default-font-family)';
const LEGACY_DEFAULT_FONT_FAMILY_NORMALIZER = {
    type: 'empty-fallback',
    fallbackValue: LEGACY_DEFAULT_FONT_FAMILY,
} as const satisfies StyleCssValueNormalizer;
const TEXT_INHERITED_PROPERTIES = [
    ['_ww-text_textAlign', 'textAlign'],
    ['_ww-text_color', 'color'],
    ['_ww-text_textTransform', 'textTransform'],
    ['_ww-text_textShadow', 'textShadow'],
    ['_ww-text_letterSpacing', 'letterSpacing'],
    ['_ww-text_wordSpacing', 'wordSpacing'],
    ['_ww-text_textDecoration', 'textDecoration'],
    ['_ww-text_textDecorationStyle', 'textDecorationStyle'],
    ['_ww-text_textDecorationColor', 'textDecorationColor'],
] as const;
const SECTION_ELEMENT_OTHER_PROPERTIES = ['borderRadius', 'boxShadow', 'transition', 'transform'];
const BACKGROUND_SOURCE_PROPERTIES = [
    'backgroundOrder',
    'backgroundColor',
    'backgroundGradient',
    'backgroundImage',
    'backgroundPositionX',
    'backgroundPositionY',
    'backgroundSize',
    'backgroundRepeat',
    'backgroundAttachment',
] as const;
const BACKGROUND_EMPTY_FALLBACKS: Partial<
    Record<(typeof BACKGROUND_SOURCE_PROPERTIES)[number], StyleCssValueNormalizer>
> = {
    backgroundColor: { type: 'empty-fallback', fallbackValue: 'transparent' },
    backgroundGradient: { type: 'empty-fallback', fallbackValue: 'none' },
    backgroundPositionX: { type: 'empty-fallback', fallbackValue: 'center' },
    backgroundPositionY: { type: 'empty-fallback', fallbackValue: 'center' },
    backgroundSize: { type: 'empty-fallback', fallbackValue: 'cover' },
    backgroundRepeat: { type: 'empty-fallback', fallbackValue: 'no-repeat' },
    backgroundAttachment: { type: 'empty-fallback', fallbackValue: 'scroll' },
};
const BACKGROUND_RUNTIME_VALIDATION_PROPERTIES = {
    backgroundOrder: 'background',
    backgroundColor: 'background',
    // Legacy gradient tokens may resolve to either a color or an image and are emitted through the
    // background shorthand when needed, so the narrower background-image grammar is not safe here.
    backgroundGradient: 'background',
    backgroundImage: 'background-image',
    backgroundPositionX: 'background-position',
    backgroundPositionY: 'background-position',
    backgroundSize: 'background-size',
    backgroundRepeat: 'background-repeat',
    backgroundAttachment: 'background-attachment',
} as const;
const POSITIONED_VALUES = ['absolute', 'fixed', 'sticky'] as const;
const NON_STICKY_POSITIONED_VALUES = ['absolute', 'fixed'] as const;
const LEGACY_ANIMATION_ITERATION_NORMALIZER = {
    type: 'falsy-fallback',
    fallbackValue: 'infinite',
} as const satisfies StyleCssValueNormalizer;
const LEGACY_FALSY_LAYOUT_VALUE_NORMALIZER = {
    type: 'empty-if-falsy',
} as const satisfies StyleCssValueNormalizer;
const LEGACY_EMPTY_COMPONENT_SIZE_NORMALIZER = {
    type: 'component-size',
} as const satisfies StyleCssValueNormalizer;
const LEGACY_AUTO_COMPONENT_SIZE_NORMALIZER = {
    type: 'component-size',
    fallbackValue: 'auto',
} as const satisfies StyleCssValueNormalizer;
const SECTION_ROOT_AUTO_ALIGN_PROPERTY = '--ww-section-root-auto-align';
const SECTION_ROOT_AUTO_WIDTH_PROPERTY = '--ww-section-root-auto-width';
const SECTION_ROOT_AUTO_ALIGN_VALUE = `var(${SECTION_ROOT_AUTO_ALIGN_PROPERTY}, unset)`;

const declarationResolversBySurfaceKind = new Map<StyleSurface['kind'], StyleDeclarationResolver[]>();

/**
 * Returns declaration resolvers for a rendered surface.
 *
 * This is based on the rendered surface, not only on the data source. A section uses one source
 * reader but emits CSS for two different DOM surfaces.
 */
export function getDeclarationResolvers(surface: StyleSurface): StyleDeclarationResolver[] {
    const cachedResolvers = declarationResolversBySurfaceKind.get(surface.kind);
    if (cachedResolvers) return cachedResolvers;

    let resolvers: StyleDeclarationResolver[];

    switch (surface.kind) {
        case 'element':
            resolvers = createElementDeclarationResolvers();
            break;
        case 'section-container':
            resolvers = createSectionContainerDeclarationResolvers();
            break;
        case 'section-element':
            resolvers = createSectionElementDeclarationResolvers();
            break;
        case 'element-layout':
        case 'section-layout':
            resolvers = createLayoutDeclarationResolvers();
            break;
        default:
            resolvers = [];
    }

    declarationResolversBySurfaceKind.set(surface.kind, resolvers);
    return resolvers;
}

/**
 * Creates a declaration for one custom CSS property after slot resolution.
 */
export function createCustomCssDeclaration({
    property,
    value,
    rule,
}: {
    property: string;
    value: unknown;
    rule?: CompiledStyleRuleTarget;
}): CompiledStyleDeclaration | null {
    if (value === undefined) return null;

    return {
        property,
        value,
        rule,
    };
}

/**
 * Creates declaration resolvers for normal elements.
 *
 * Element CSS is the broadest set because normal elements can own layout, box, visual, and
 * interaction properties.
 */
function createElementDeclarationResolvers(): StyleDeclarationResolver[] {
    const resolvers: StyleDeclarationResolver[] = [
        createLegacyFalsyFallbackDeclarationResolver('margin', '0'),
        createLegacyFalsyFallbackDeclarationResolver('padding', '0'),
        createPropertyDeclarationResolver('overflow'),
        createLegacyFalsyFallbackDeclarationResolver('zIndex', 'unset'),
        createElementAlignDeclaration,
        scope => [createDisplayDeclaration(scope)],
        createPositionDeclarations,
        createElementWidthDeclaration,
        createPropertyDeclarationResolver('flex'),
        createLegacyComponentSizeDeclarationResolver('maxWidth', 'unset'),
        createLegacyComponentSizeDeclarationResolver('minWidth', 'unset'),
        scope => {
            const perspective = read(scope, 'perspective');
            if (!hasNonZeroLength(perspective)) return [];

            return [createDeclaration(scope, 'perspective', perspective)];
        },
        createLegacyFalsyFallbackDeclarationResolver('height', 'auto'),
        createPropertyDeclarationResolver('aspectRatio'),
        createLegacyComponentSizeDeclarationResolver('maxHeight', 'unset'),
        createLegacyComponentSizeDeclarationResolver('minHeight', 'unset'),
        createTextDeclarations,
        createBackgroundDeclarations,
        createPropertyDeclarationResolver('cursor'),
        createPropertyDeclarationResolver('pointerEvents'),
        createGridChildDeclarations,
    ];

    for (const property of ELEMENT_OTHER_PROPERTIES) {
        resolvers.push(createPropertyDeclarationResolver(property));
    }

    // Animation direction/play-state hold booleanish legacy data or modern CSS keywords; a plain
    // resolver would let the compiler value normalizer drop keyword strings, so coerce explicitly.
    resolvers.push(
        scope => [createAnimationIterationCountDeclaration(scope)],
        scope => [createAnimationEnumDeclaration(scope, 'animationDirection', 'alternate', 'normal')],
        scope => [createAnimationEnumDeclaration(scope, 'animationPlayState', 'running', 'paused')],
        // `animation-name` is derived: it points at the element-scoped `@keyframes` (createKeyframesRule)
        // and is emitted only when the element actually defines keyframes in this slot.
        createAnimationNameDeclaration
    );

    resolvers.push(createBorderDeclarations);

    resolvers.push(
        createPropertyDeclarationResolver('outline'),
        createPropertyDeclarationResolver('outlineOffset'),
        createPropertyDeclarationResolver('borderRadius'),
        createConfigCssDeclarations
    );

    return resolvers;
}

/**
 * Creates declaration resolvers for the outer section container.
 *
 * It owns section-level positioning, overflow, background, and sizing.
 */
function createSectionContainerDeclarationResolvers(): StyleDeclarationResolver[] {
    return [
        createLegacyComponentSizeDeclarationResolver('height', 'auto'),
        createPropertyDeclarationResolver('aspectRatio'),
        createPropertyDeclarationResolver('margin'),
        createLegacyFalsyFallbackDeclarationResolver('zIndex', 'unset'),
        createPropertyDeclarationResolver('overflow'),
        createPropertyDeclarationResolver('opacity'),
        createLegacyComponentSizeDeclarationResolver('minHeight', 'unset'),
        createLegacyComponentSizeDeclarationResolver('maxHeight', 'unset'),
        scope => [createDisplayDeclaration(scope)],
        createBackgroundDeclarations,
        scope => createPositionDeclarations(scope, { includeStickyWidth: true }),
        createPropertyDeclarationResolver('cursor'),
        createPropertyDeclarationResolver('transition'),
        createPropertyDeclarationResolver('transform'),
        createConfigCssDeclarations,
    ];
}

/**
 * Creates declaration resolvers for the inner section content wrapper.
 *
 * It receives width/padding constraints that would be wrong on the outer section container.
 */
function createSectionElementDeclarationResolvers(): StyleDeclarationResolver[] {
    const resolvers: StyleDeclarationResolver[] = [
        createSectionRootCompatibilityDeclarations,
        createLegacyComponentSizeDeclarationResolver('width', '100%'),
        createPropertyDeclarationResolver('padding'),
        createLegacyComponentSizeDeclarationResolver('maxWidth', 'unset'),
        createLegacyComponentSizeDeclarationResolver('minWidth', 'unset'),
        createLegacyComponentSizeDeclarationResolver('minHeight', 'unset'),
        createLegacyComponentSizeDeclarationResolver('maxHeight', 'unset'),
        scope => {
            const perspective = read(scope, 'perspective');
            if (!hasNonZeroLength(perspective)) return [];

            return [createDeclaration(scope, 'perspective', perspective)];
        },
        createBorderDeclarations,
    ];

    for (const property of SECTION_ELEMENT_OTHER_PROPERTIES) {
        resolvers.push(createPropertyDeclarationResolver(property));
    }

    return resolvers;
}

/**
 * Restores the legacy default for direct children of stretched column sections.
 *
 * The section owns inherited custom properties, while each direct child decides whether its own
 * align/width values should consume them. Keeping the decision in generated CSS lets section states
 * and breakpoints update every child without component-level style resolution.
 */
function createSectionRootCompatibilityDeclarations(scope: DeclarationScope) {
    const ownFlexDirection = read(scope, '_ww-layout_flexDirection', 'content');
    const ownAlignItems = read(scope, '_ww-layout_alignItems', 'content');
    const isBaseSlot = scope.state === 'base' && scope.breakpoint === 'default';
    if (!isBaseSlot && ownFlexDirection === undefined && ownAlignItems === undefined) return [];

    const flexDirection = readEffective(scope, '_ww-layout_flexDirection', 'content') || 'row';
    const alignItems = readEffective(scope, '_ww-layout_alignItems', 'content') || 'stretch';

    return [
        createDeclaration(
            scope,
            SECTION_ROOT_AUTO_ALIGN_PROPERTY,
            createSectionRootCompatibilityValue(scope, flexDirection, alignItems, 'center', 'auto-align')
        ),
        createDeclaration(
            scope,
            SECTION_ROOT_AUTO_WIDTH_PROPERTY,
            createSectionRootCompatibilityValue(scope, flexDirection, alignItems, '100%', 'auto-width')
        ),
    ];
}

function createSectionRootCompatibilityValue(
    scope: DeclarationScope,
    flexDirection: unknown,
    alignItems: unknown,
    activeValue: string,
    outputKey: string
) {
    const hasDynamicLayout =
        isStyleDynamicVariableReference(flexDirection) || isStyleDynamicVariableReference(alignItems);
    if (!hasDynamicLayout) {
        if (flexDirection === 'column' && alignItems === 'stretch') return activeValue;

        return scope.state === 'base' && scope.breakpoint === 'default' ? undefined : 'initial';
    }

    return createConditionalDynamicCssVariableReference({
        input: scope.input,
        surface: scope.surface,
        sourceUid: scope.source.uid(),
        domain: 'content',
        property: '_ww-layout_sectionRootCompatibility',
        outputKey,
        state: scope.state,
        breakpoint: scope.breakpoint,
        value: activeValue,
        condition: [
            { value: unwrapDynamicVariableValue(flexDirection), allowedValues: ['column'] },
            { value: unwrapDynamicVariableValue(alignItems), allowedValues: ['stretch'] },
        ],
        cssFallbackValue: 'initial',
    });
}

function createElementAlignDeclaration(scope: DeclarationScope) {
    const isSectionRoot = isDirectSectionChild(scope);
    const emptyAlignValue = isSectionRoot ? SECTION_ROOT_AUTO_ALIGN_VALUE : 'unset';
    const align = read(scope, 'align', 'style', LEGACY_FALSY_LAYOUT_VALUE_NORMALIZER);
    if (!isStyleDynamicVariableReference(align)) {
        if (align === undefined) return [createDeclaration(scope, 'alignSelf', undefined, emptyAlignValue)];

        return [
            createDeclaration(
                scope,
                'alignSelf',
                normalizeStyleRuntimeValue(align, LEGACY_FALSY_LAYOUT_VALUE_NORMALIZER) || emptyAlignValue
            ),
        ];
    }

    if (!isSectionRoot) {
        return [createDeclaration(scope, 'alignSelf', align.withCssFallback(emptyAlignValue))];
    }

    return [
        createDeclaration(
            scope,
            'alignSelf',
            createWhenEmptyDynamicCssVariableReference({
                input: scope.input,
                surface: scope.surface,
                sourceUid: scope.source.uid(),
                domain: 'style',
                property: 'align',
                outputKey: 'section-root',
                valueNormalizer: LEGACY_FALSY_LAYOUT_VALUE_NORMALIZER,
                state: scope.state,
                breakpoint: scope.breakpoint,
                value: align.variable.value,
                condition: align.variable.condition,
                runtimeFallback: {
                    type: 'when-empty',
                    value: SECTION_ROOT_AUTO_ALIGN_VALUE,
                },
                cssFallbackValue: SECTION_ROOT_AUTO_ALIGN_VALUE,
            })
        ),
    ];
}

function createElementWidthDeclaration(scope: DeclarationScope) {
    const autoByContent = getStyleComponentCapabilities(scope.source).autoByContent === true;
    const libraryComponentInstance = isLibraryComponentInstance(scope);
    if (!isDirectSectionChild(scope)) {
        // The legacy runtime merged an instance width before applying getComponentSize(). An explicit
        // empty/auto instance value therefore removed the concrete root width instead of revealing it.
        const valueNormalizer =
            autoByContent || libraryComponentInstance
                ? LEGACY_AUTO_COMPONENT_SIZE_NORMALIZER
                : LEGACY_EMPTY_COMPONENT_SIZE_NORMALIZER;
        const width = read(scope, 'width', 'style', valueNormalizer);
        if (width === undefined) {
            return [createDeclaration(scope, 'width', undefined, autoByContent ? 'auto' : undefined)];
        }
        if (isStyleDynamicVariableReference(width)) {
            return [createDeclaration(scope, 'width', autoByContent ? width.withCssFallbackIfMissing('auto') : width)];
        }

        const normalizedWidth = normalizeStyleRuntimeValue(width, valueNormalizer);
        return [
            createDeclaration(scope, 'width', normalizedWidth ?? (libraryComponentInstance ? 'auto' : 'revert-layer')),
        ];
    }

    const ownWidth = read(scope, 'width');
    const ownAlign = read(scope, 'align');
    const isBaseSlot = scope.state === 'base' && scope.breakpoint === 'default';
    if (!isBaseSlot && ownWidth === undefined && ownAlign === undefined) return [];

    const width = readEffective(scope, 'width', 'style', LEGACY_EMPTY_COMPONENT_SIZE_NORMALIZER);
    const align = readEffective(scope, 'align', 'style', LEGACY_FALSY_LAYOUT_VALUE_NORMALIZER);
    // Keep an omitted instance width transparent, but make an explicit empty/auto width mask the
    // library definition while still participating in the legacy stretched-section fallback.
    const emptyInstanceWidthFallback = libraryComponentInstance && width !== undefined ? 'auto' : 'revert-layer';

    return [
        createDeclaration(
            scope,
            'width',
            createSectionRootWidthValue(scope, width, align, autoByContent, emptyInstanceWidthFallback)
        ),
    ];
}

function createSectionRootWidthValue(
    scope: DeclarationScope,
    width: unknown,
    align: unknown,
    autoByContent: boolean,
    emptyWidthFallback: 'auto' | 'revert-layer'
) {
    const emptyWidth = autoByContent ? 'auto' : createSectionRootAutoWidthValue(emptyWidthFallback);
    if (isStyleDynamicVariableReference(width)) {
        if (align && !isStyleDynamicVariableReference(align)) {
            return width.withCssFallbackIfMissing(autoByContent ? 'auto' : emptyWidthFallback);
        }

        const fallbackValues = isStyleDynamicVariableReference(align) ? [align.variable.value] : [];

        return createWhenAllEmptyDynamicCssVariableReference({
            input: scope.input,
            surface: scope.surface,
            sourceUid: scope.source.uid(),
            domain: 'style',
            property: 'width',
            outputKey: 'section-root',
            valueNormalizer: width.variable.valueNormalizer,
            omitWhenUndefined: width.variable.omitWhenUndefined,
            state: scope.state,
            breakpoint: scope.breakpoint,
            value: width.variable.value,
            condition: width.variable.condition,
            runtimeFallback: {
                type: 'when-all-empty',
                dependencies: fallbackValues,
                value: emptyWidth,
            },
            cssFallbackValue: align ? (autoByContent ? 'auto' : emptyWidthFallback) : emptyWidth,
        });
    }

    if (width && (width !== 'auto' || autoByContent)) return width;
    if (autoByContent) return 'auto';

    if (isStyleDynamicVariableReference(align)) {
        return createConditionalDynamicCssVariableReference({
            input: scope.input,
            surface: scope.surface,
            sourceUid: scope.source.uid(),
            domain: 'style',
            property: 'width',
            outputKey: 'section-root-align',
            state: scope.state,
            breakpoint: scope.breakpoint,
            value: emptyWidthFallback,
            condition: { value: align.variable.value, truthy: true },
            cssFallbackValue: emptyWidth,
        });
    }

    return align ? emptyWidthFallback : emptyWidth;
}

function createSectionRootAutoWidthValue(fallback: 'auto' | 'revert-layer') {
    return `var(${SECTION_ROOT_AUTO_WIDTH_PROPERTY}, ${fallback})`;
}

function isLibraryComponentInstance(scope: DeclarationScope) {
    if (scope.source.kind() !== 'element') return false;

    return (scope.source as StyleElementReader).isLibraryComponentInstance?.() === true;
}

function isDirectSectionChild(scope: DeclarationScope) {
    if (scope.source.kind() !== 'element') return false;

    return (scope.source as StyleElementReader).isDirectSectionChild();
}

/**
 * Creates declaration resolvers for `wwLayout` CSS stored as component content.
 */
function createLayoutDeclarationResolvers(): StyleDeclarationResolver[] {
    return [createLayoutDeclarations];
}

/**
 * Creates CSS from text content properties for components that inherit `ww-text`.
 *
 * Most text properties naturally inherit from the root element to component-owned text nodes.
 * Surface-specific behavior such as overflow/ellipsis belongs to the component `css()` hook because
 * only the component knows which inner DOM node consumes those bridge variables.
 */
function createTextDeclarations(scope: DeclarationScope) {
    if (!sourceInheritsText(scope.source)) return [];

    const declarations: Array<CompiledStyleDeclaration | null> = [];
    const fontPropertyEnabled = shouldEmitTextProperty(scope, '_ww-text_font');
    const font = fontPropertyEnabled ? readTextProperty(scope, '_ww-text_font') : undefined;
    const fontSlotOrigin = fontPropertyEnabled ? getTextPropertyOrigin(scope, '_ww-text_font') : undefined;
    const shouldEmitFont = hasResolvedValue(font);
    const fontOrigin = shouldEmitFont ? fontSlotOrigin : undefined;
    const restoresEffectiveLonghands = !!fontSlotOrigin && !shouldEmitFont;

    if (shouldEmitFont) {
        declarations.push(createDeclaration(scope, 'font', font));
    }

    // V17 cleaned ignored legacy longhands on sources, classes and subclasses.
    // New overrides beside a typography token can now apply at any of these origins.
    for (const [sourceProperty, cssProperty] of TEXT_FONT_LONGHAND_PROPERTIES) {
        if (!shouldEmitTextProperty(scope, sourceProperty)) continue;
        if (!shouldEmitTextLonghand(scope, sourceProperty, fontOrigin, font)) continue;

        const usesDefaultFontFamily = sourceProperty === '_ww-text_fontFamily' && !hasResolvedValue(font);
        const valueNormalizer = usesDefaultFontFamily ? LEGACY_DEFAULT_FONT_FAMILY_NORMALIZER : undefined;
        // Legacy responsive merging switched back to the effective longhand set when a narrower
        // breakpoint explicitly cleared `_ww-text_font`. Rehydrate inherited longhands here so the
        // base shorthand does not keep controlling properties omitted from that breakpoint.
        const value = restoresEffectiveLonghands
            ? readEffective(scope, sourceProperty, 'content', valueNormalizer)
            : readTextProperty(scope, sourceProperty, valueNormalizer);
        const normalizedValue =
            value !== undefined && valueNormalizer ? normalizeStyleRuntimeValue(value, valueNormalizer) : value;
        declarations.push(
            createDeclaration(
                scope,
                cssProperty,
                normalizedValue,
                usesDefaultFontFamily ? LEGACY_DEFAULT_FONT_FAMILY : undefined
            )
        );
    }

    for (const [sourceProperty, cssProperty] of TEXT_INHERITED_PROPERTIES) {
        if (!shouldEmitTextProperty(scope, sourceProperty)) continue;

        declarations.push(createAuthoredStyleDeclaration(scope, cssProperty, readTextProperty(scope, sourceProperty)));
    }

    // This compatibility value is constant and inherited by every responsive/state slot on the
    // same surface. Emitting it once keeps the legacy behavior without creating one-rule media
    // blocks for every slot.
    if (shouldEmitDefaultDeclaration(scope)) {
        declarations.push(createDeclaration(scope, 'whiteSpaceCollapse', 'preserve'));
    }

    return declarations;
}

/**
 * Creates component-configured CSS outputs for the current source slot.
 *
 * The `style` and `content` objects exposed to config code are compiler-owned proxies: each
 * property access reads the current state/breakpoint slot and keeps formula handling inside the
 * compiler.
 */
function createConfigCssDeclarations(scope: DeclarationScope) {
    const declarations: Array<CompiledStyleDeclaration | null> = [];
    const capabilities = getStyleComponentCapabilities(scope.source);
    const cssFactories = getCssFactories(capabilities.css);

    if (!cssFactories.length) return declarations;

    const context = {
        state: scope.state,
        breakpoint: scope.breakpoint,
        content: createCssPropertyProxy(scope, 'content'),
        style: createCssPropertyProxy(scope, 'style'),
    };

    for (const cssFactory of cssFactories) {
        let outputs: readonly StyleCssOutput[] | null | undefined;
        try {
            outputs = cssFactory(context);
        } catch (error) {
            scope.input.stylesheet.diagnostic?.({
                code: 'css-factory-error',
                surface: scope.surface,
                selector: scope.surface.selector,
                message: `Component CSS factory failed: ${error instanceof Error ? error.message : 'unknown error'}.`,
            });
            continue;
        }

        if (!Array.isArray(outputs)) continue;

        for (const output of outputs) {
            declarations.push(createCssOutputDeclaration(scope, output));
        }
    }

    return declarations;
}

function getCssFactories(css: ReturnType<typeof getStyleComponentCapabilities>['css']) {
    if (typeof css === 'function') return [css];
    if (!Array.isArray(css)) return [];

    return css.filter(cssFactory => typeof cssFactory === 'function');
}

function createCssOutputDeclaration(scope: DeclarationScope, output: StyleCssOutput): CompiledStyleDeclaration | null {
    if (!isCssOutput(output)) return null;

    return createDeclaration(scope, output.property, output.value);
}

function isCssOutput(value: unknown): value is StyleCssOutput {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;

    const output = value as Partial<StyleCssOutput>;
    return typeof output.property === 'string' && Object.hasOwn(output, 'value');
}

function createCssPropertyProxy(scope: DeclarationScope, domain: StylePropertyDomain): StyleCssPropertyProxy {
    return new Proxy(Object.create(null), {
        get(_, property) {
            if (typeof property !== 'string') return undefined;
            if (property === '_mapValue') {
                return (sourceProperty: string, outputKey: string, valueMap: StyleCssValueMap) =>
                    createMappedCssPropertyValue(scope, domain, sourceProperty, outputKey, valueMap);
            }

            return read(scope, property, domain);
        },
        has() {
            return false;
        },
        ownKeys() {
            return [];
        },
        getOwnPropertyDescriptor() {
            return undefined;
        },
    });
}

function createMappedCssPropertyValue(
    scope: DeclarationScope,
    domain: StylePropertyDomain,
    property: string,
    outputKey: string,
    valueMap: StyleCssValueMap
) {
    if (typeof property !== 'string' || typeof outputKey !== 'string' || !isCssValueMap(valueMap)) return undefined;

    return resolveMappedStyleProperty({
        input: scope.input,
        surface: scope.surface,
        source: scope.source,
        property,
        outputKey,
        valueMap,
        state: scope.state,
        breakpoint: scope.breakpoint,
        slot: scope.slot(domain),
        domain,
    });
}

function isCssValueMap(value: unknown): value is StyleCssValueMap {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Creates a resolver for the common "read one style property, emit one declaration" case.
 */
function createPropertyDeclarationResolver(property: string, defaultValue?: unknown): StyleDeclarationResolver {
    const hasDefaultValue = defaultValue !== undefined;

    return scope => {
        if (!shouldEmitStyleProperty(scope, property)) return [];

        return [
            hasDefaultValue
                ? createAuthoredStyleDeclaration(scope, property, read(scope, property), defaultValue)
                : createAuthoredStyleDeclaration(scope, property, read(scope, property)),
        ];
    };
}

/**
 * Preserves the legacy effective border when a state or breakpoint sets the shorthand.
 *
 * The inline-style renderer resolved every border property independently. CSS shorthand rules reset
 * inherited longhands, so inherited sides must be emitted again after a newly configured shorthand.
 */
function createBorderDeclarations(scope: DeclarationScope) {
    const border = shouldEmitStyleProperty(scope, 'border') ? read(scope, 'border') : undefined;
    const borderDeclaration = createDeclaration(scope, 'border', border);
    const declarations: Array<CompiledStyleDeclaration | null> = [borderDeclaration];

    for (const property of BORDER_LONGHAND_PROPERTIES) {
        if (!shouldEmitStyleProperty(scope, property)) continue;

        const currentValue = read(scope, property);
        const value = currentValue === undefined && borderDeclaration ? readEffective(scope, property) : currentValue;
        declarations.push(createDeclaration(scope, property, value));
    }

    return declarations;
}

/**
 * Reproduces `getComponentSize(value, fallback)` for both persisted and formula-backed values.
 */
function createLegacyComponentSizeDeclarationResolver(
    property: string,
    fallbackValue: unknown
): StyleDeclarationResolver {
    const valueNormalizer = {
        type: 'component-size',
        fallbackValue,
    } as const satisfies StyleCssValueNormalizer;

    return scope => {
        if (!shouldEmitStyleProperty(scope, property)) return [];

        const value = read(scope, property, 'style', valueNormalizer);
        if (value === undefined) return [createDeclaration(scope, property, undefined, fallbackValue)];
        if (isStyleDynamicVariableReference(value)) {
            return [createDeclaration(scope, property, value.withCssFallbackIfMissing(fallbackValue))];
        }

        return [createDeclaration(scope, property, normalizeStyleRuntimeValue(value, valueNormalizer))];
    };
}

/**
 * Reproduces legacy `value || fallback` declarations for persisted and formula-backed values.
 */
function createLegacyFalsyFallbackDeclarationResolver(
    property: string,
    fallbackValue: unknown
): StyleDeclarationResolver {
    const valueNormalizer = {
        type: 'falsy-fallback',
        fallbackValue,
    } as const satisfies StyleCssValueNormalizer;

    return scope => {
        if (!shouldEmitStyleProperty(scope, property)) return [];

        const value = read(scope, property, 'style', valueNormalizer);
        if (value === undefined) return [createDeclaration(scope, property, undefined, fallbackValue)];
        if (isStyleDynamicVariableReference(value)) {
            return [createDeclaration(scope, property, value.withCssFallbackIfMissing(fallbackValue))];
        }

        return [createDeclaration(scope, property, normalizeStyleRuntimeValue(value, valueNormalizer))];
    };
}

/**
 * Preserves the historic animation loop default without affecting elements that have no animation.
 *
 * The former runtime used `animationIterationCount || 'infinite'` whenever a duration activated an
 * animation. CSS defaults to a single iteration, so the compiler must keep that WeWeb default at the
 * slot that introduces the duration while allowing an explicit inherited iteration count to win.
 */
function createAnimationIterationCountDeclaration(scope: DeclarationScope) {
    if (!shouldEmitStyleProperty(scope, 'animationIterationCount')) return null;

    const iterationCount = read(scope, 'animationIterationCount', 'style', LEGACY_ANIMATION_ITERATION_NORMALIZER);
    if (isStyleDynamicVariableReference(iterationCount)) {
        return createDeclaration(scope, 'animationIterationCount', iterationCount.withCssFallback('infinite'));
    }
    if (iterationCount) return createDeclaration(scope, 'animationIterationCount', iterationCount);
    if (!read(scope, 'animationDuration')) return null;
    if (readEffective(scope, 'animationIterationCount')) return null;

    return createDeclaration(scope, 'animationIterationCount', 'infinite');
}

/**
 * Coerces animation enum props (direction/play-state) that may hold legacy booleans or CSS keywords.
 *
 * A plain resolver would run the value through the compiler normalizer, which maps only strict
 * booleans and drops keyword strings. Here keywords and dynamic formulas pass through unchanged.
 */
function createAnimationEnumDeclaration(
    scope: DeclarationScope,
    property: string,
    trueKeyword: string,
    falseKeyword: string
): CompiledStyleDeclaration | null {
    if (!shouldEmitStyleProperty(scope, property)) return null;

    const value = read(scope, property);
    if (value === undefined) return null;
    if (value === true) return createDeclaration(scope, property, trueKeyword);
    if (value === false) return createDeclaration(scope, property, falseKeyword);

    return createDeclaration(scope, property, value);
}

/**
 * Emits `animation-name` for the CURRENT slot. Static keyframes use the compiler-owned block name;
 * bound keyframes use a CSS variable populated alongside an instance-scoped runtime block. Both
 * paths keep state, breakpoint, and repeated component instances isolated.
 */
function createAnimationNameDeclaration(scope: DeclarationScope): Array<CompiledStyleDeclaration | null> {
    if (!shouldEmitStyleProperty(scope, 'animationKeyframes')) return [];

    const dynamicKeyframes = read(scope, 'animationKeyframes');
    if (isStyleDynamicVariableReference(dynamicKeyframes)) {
        return [
            createDeclaration(scope, 'animationName', dynamicKeyframes.asRuntimeKeyframes(getKeyframesName(scope))),
        ];
    }

    const keyframes = createKeyframesRule(scope);
    if (!keyframes) return [];

    return [createDeclaration(scope, 'animationName', keyframes.name)];
}

/**
 * `@keyframes` name for the current slot.
 *
 * `@keyframes` names are global, so the name must be unique per rendered surface (library child
 * overrides share a definition uid but differ in `surface.key`) AND per state/breakpoint slot (a
 * component can define different keyframes per state/breakpoint). `read()` is own-slot, so only the
 * slot that actually owns the keyframes emits a block+name; other slots inherit via the CSS cascade.
 */
function getKeyframesName(scope: DeclarationScope) {
    const scopeKey = scope.surface.key.replace(/[^a-zA-Z0-9_-]/g, '-');
    return `ww-keyframes-${scopeKey}-${scope.state}-${scope.breakpoint}`;
}

/**
 * Builds the slot-scoped `@keyframes` block from author-written `animationKeyframes` CSS.
 *
 * The stored value is already a raw `@keyframes … { … }` block; we only rewrite its name to the
 * slot-scoped name so it matches `createAnimationNameDeclaration`. Only plain string values are
 * emitted here (bindable/dynamic keyframes are registered by `createAnimationNameDeclaration` for
 * the browser runtime); `read()` being own-slot means a non-null result only for the exact slot that
 * defines the keyframes.
 */
export function createKeyframesRule(scope: DeclarationScope): { name: string; css: string } | null {
    if (!shouldEmitStyleProperty(scope, 'animationKeyframes')) return null;

    const keyframes = read(scope, 'animationKeyframes');
    const name = getKeyframesName(scope);
    const css = rewriteAnimationKeyframes(keyframes, name);
    if (!css) return null;

    return { name, css };
}

/**
 * Resolves display with generic CSS display validation.
 */
function createDisplayDeclaration(scope: DeclarationScope) {
    if (!shouldEmitStyleProperty(scope, 'display')) return null;

    const allowedDisplayValues = getAllowedDisplayValues(scope.source);
    const restrictToAllowedValues = hasConfiguredDisplayAllowedValues(scope.source);
    const display = readDisplay(scope, allowedDisplayValues, restrictToAllowedValues);
    if (display === undefined && !shouldEmitDefaultDeclaration(scope)) return null;
    if (display === undefined) {
        return createDeclaration(scope, 'display', undefined, allowedDisplayValues[0]);
    }

    return createDeclaration(
        scope,
        'display',
        // If display is configured in this slot, normalize it to valid CSS. If it is absent,
        // only the base/default rule gets the historic generic fallback.
        getDisplayValue(display, allowedDisplayValues, restrictToAllowedValues)
    );
}

/**
 * Creates position and offset declarations for absolute/fixed/sticky surfaces.
 */
function createPositionDeclarations(
    scope: DeclarationScope,
    { includeStickyWidth = false }: { includeStickyWidth?: boolean } = {}
) {
    if (!shouldEmitStyleProperty(scope, 'position')) return [];

    const position = read(scope, 'position');
    const offsets = readPositionOffsets(scope, read);
    const effectivePosition = readEffective(scope, 'position');
    const effectiveOffsets = readPositionOffsets(scope, readEffective);
    const width = includeStickyWidth
        ? read(scope, 'width', 'style', LEGACY_EMPTY_COMPONENT_SIZE_NORMALIZER)
        : undefined;
    const effectiveWidth = includeStickyWidth
        ? readEffective(scope, 'width', 'style', LEGACY_EMPTY_COMPONENT_SIZE_NORMALIZER)
        : undefined;
    const declarations: Array<CompiledStyleDeclaration | null> = [];
    const dynamicPosition = isStyleDynamicVariableReference(position) ? position : null;
    const dynamicEffectivePosition = isStyleDynamicVariableReference(effectivePosition) ? effectivePosition : null;
    const hasCurrentOffsets = hasPositionOffset(offsets);
    const hasCurrentWidth = width !== undefined;

    if (dynamicPosition) {
        declarations.push(
            createConditionalPositionDeclaration(scope, dynamicPosition),
            ...createConditionalPositionOffsetDeclarations(scope, dynamicPosition, effectiveOffsets)
        );
        if (includeStickyWidth) {
            declarations.push(
                createConditionalSectionWidthDeclaration(scope, dynamicPosition, effectiveWidth, effectiveOffsets)
            );
        }
    } else if (position !== undefined) {
        if (!isPositionedValue(position)) {
            declarations.push(
                createDeclaration(scope, 'position', 'revert-layer'),
                ...POSITION_OFFSET_PROPERTIES.map(property => createDeclaration(scope, property, 'revert-layer'))
            );
            if (includeStickyWidth) declarations.push(createDeclaration(scope, 'width', 'revert-layer'));
        } else {
            declarations.push(
                createDeclaration(scope, 'position', position),
                ...createPositionOffsetDeclarations(scope, effectiveOffsets)
            );
        }
    } else if (dynamicEffectivePosition) {
        if (!hasCurrentOffsets && !hasCurrentWidth) return declarations;

        if (hasCurrentOffsets) {
            declarations.push(
                ...createConditionalPositionOffsetDeclarations(scope, dynamicEffectivePosition, effectiveOffsets)
            );
        }
        if (includeStickyWidth) {
            declarations.push(
                createConditionalSectionWidthDeclaration(
                    scope,
                    dynamicEffectivePosition,
                    effectiveWidth,
                    effectiveOffsets
                )
            );
        }
    } else {
        if (!isPositionedValue(effectivePosition) || !hasCurrentOffsets) return declarations;

        for (const property of POSITION_OFFSET_PROPERTIES) {
            declarations.push(createDeclaration(scope, property, offsets[property]));
        }
    }

    if (includeStickyWidth && isPositionedValue(effectivePosition)) {
        declarations.push(
            createDeclaration(
                scope,
                'width',
                effectivePosition !== 'sticky' || !hasPositionOffset(effectiveOffsets)
                    ? // The old section runtime injected a width fallback for positioned stretched
                      // sections. Keep that behavior here for section containers.
                      getExplicitComponentSize(effectiveWidth)
                    : 'revert-layer'
            )
        );
    }

    return declarations;
}

const POSITION_OFFSET_PROPERTIES = ['top', 'right', 'bottom', 'left'] as const;
type PositionOffsetProperty = (typeof POSITION_OFFSET_PROPERTIES)[number];
type PositionOffsets = Record<PositionOffsetProperty, unknown>;

function readPositionOffsets(
    scope: DeclarationScope,
    readProperty: (scope: DeclarationScope, property: PositionOffsetProperty) => unknown
): PositionOffsets {
    return Object.fromEntries(
        POSITION_OFFSET_PROPERTIES.map(property => [property, readProperty(scope, property)])
    ) as PositionOffsets;
}

function hasPositionOffset(offsets: PositionOffsets) {
    return POSITION_OFFSET_PROPERTIES.some(property => {
        const value = offsets[property];
        return value !== undefined && value !== null && value !== '';
    });
}

function isPositionedValue(value: unknown): value is (typeof POSITIONED_VALUES)[number] {
    return typeof value === 'string' && POSITIONED_VALUES.includes(value as (typeof POSITIONED_VALUES)[number]);
}

function createPositionOffsetDeclarations(scope: DeclarationScope, offsets: PositionOffsets) {
    const runtimeFallbackTop = createRuntimeFallbackTopVariable(scope, offsets);
    const hasOffset = hasTruthyPositionOffset(offsets);

    return POSITION_OFFSET_PROPERTIES.map(property => {
        if (property === 'top' && runtimeFallbackTop) {
            return createDeclaration(scope, property, runtimeFallbackTop);
        }

        return createDeclaration(scope, property, property === 'top' && !hasOffset ? '0px' : offsets[property]);
    });
}

function createConditionalPositionDeclaration(scope: DeclarationScope, position: StyleDynamicVariableReference) {
    return createDeclaration(
        scope,
        'position',
        createConditionalPositionVariable(scope, 'position', position.variable.value, position, 'revert-layer')
    );
}

function createConditionalPositionOffsetDeclarations(
    scope: DeclarationScope,
    position: StyleDynamicVariableReference,
    offsets: PositionOffsets
) {
    const runtimeFallbackTop = createRuntimeFallbackTopVariable(scope, offsets, position);
    const hasOffset = hasTruthyPositionOffset(offsets);

    return POSITION_OFFSET_PROPERTIES.map(property => {
        if (property === 'top' && runtimeFallbackTop) {
            return createDeclaration(scope, property, runtimeFallbackTop);
        }

        const offset = property === 'top' && !hasOffset ? '0px' : offsets[property];
        if (offset === undefined || offset === null || offset === '') {
            return createDeclaration(scope, property, 'revert-layer');
        }

        const dynamicOffset = isStyleDynamicVariableReference(offset) ? offset : null;
        return createDeclaration(
            scope,
            property,
            createConditionalPositionVariable(
                scope,
                property,
                dynamicOffset?.variable.value ?? offset,
                position,
                'revert-layer',
                dynamicOffset?.variable.valueNormalizer
            )
        );
    });
}

function createRuntimeFallbackTopVariable(
    scope: DeclarationScope,
    offsets: PositionOffsets,
    position?: StyleDynamicVariableReference
) {
    const values = POSITION_OFFSET_PROPERTIES.filter(property => property !== 'top').map(property =>
        unwrapDynamicVariableValue(offsets[property])
    );
    const hasDynamicOffset = POSITION_OFFSET_PROPERTIES.some(property =>
        isStyleDynamicVariableReference(offsets[property])
    );
    if (!hasDynamicOffset) return null;

    const top = offsets.top;
    const topIsDynamic = isStyleDynamicVariableReference(top);
    const hasTruthyStaticOffset = POSITION_OFFSET_PROPERTIES.some(property => {
        const offset = offsets[property];
        return !isStyleDynamicVariableReference(offset) && !!offset;
    });
    if (!topIsDynamic && hasTruthyStaticOffset) return null;

    return createWhenAllEmptyDynamicCssVariableReference({
        input: scope.input,
        surface: scope.surface,
        sourceUid: scope.source.uid(),
        domain: 'style',
        property: 'top',
        outputKey: 'positioned-fallback',
        valueNormalizer: topIsDynamic ? top.variable.valueNormalizer : undefined,
        state: scope.state,
        breakpoint: scope.breakpoint,
        value: topIsDynamic ? top.variable.value : top,
        condition: position
            ? {
                  value: position.variable.value,
                  allowedValues: POSITIONED_VALUES,
              }
            : undefined,
        runtimeFallback: {
            type: 'when-all-empty',
            dependencies: values,
            value: '0px',
        },
        cssFallbackValue: 'revert-layer',
    });
}

function unwrapDynamicVariableValue(value: unknown) {
    return isStyleDynamicVariableReference(value) ? value.variable.value : value;
}

function hasTruthyPositionOffset(offsets: PositionOffsets) {
    return POSITION_OFFSET_PROPERTIES.some(property => !!offsets[property]);
}

function createConditionalPositionVariable(
    scope: DeclarationScope,
    property: 'position' | PositionOffsetProperty | 'width',
    value: unknown,
    position: StyleDynamicVariableReference,
    cssFallbackValue: unknown,
    valueNormalizer?: StyleCssValueNormalizer,
    allowedValues: readonly string[] = POSITIONED_VALUES
) {
    return createConditionalDynamicCssVariableReference({
        input: scope.input,
        surface: scope.surface,
        sourceUid: scope.source.uid(),
        domain: 'style',
        property,
        outputKey: property === 'position' ? undefined : 'positioned',
        valueNormalizer,
        state: scope.state,
        breakpoint: scope.breakpoint,
        value,
        condition: {
            value: position.variable.value,
            allowedValues,
        },
        cssFallbackValue,
    });
}

function createConditionalSectionWidthDeclaration(
    scope: DeclarationScope,
    position: StyleDynamicVariableReference,
    width: unknown,
    offsets: PositionOffsets
) {
    const explicitWidth = getExplicitComponentSize(width);
    if (explicitWidth === undefined) return createDeclaration(scope, 'width', 'revert-layer');

    const dynamicWidth = isStyleDynamicVariableReference(explicitWidth) ? explicitWidth : null;
    return createDeclaration(
        scope,
        'width',
        createConditionalPositionVariable(
            scope,
            'width',
            dynamicWidth?.variable.value ?? explicitWidth,
            position,
            'revert-layer',
            dynamicWidth?.variable.valueNormalizer,
            hasPositionOffset(offsets) ? NON_STICKY_POSITIONED_VALUES : POSITIONED_VALUES
        )
    );
}

/**
 * Creates background longhands from WeWeb's ordered background layers.
 */
function createBackgroundDeclarations(scope: DeclarationScope) {
    if (!shouldEmitStyleProperty(scope, 'background')) return [];

    const backgroundStyle: CssStyleRecord = {};
    const backgroundValues: Partial<Record<(typeof BACKGROUND_SOURCE_PROPERTIES)[number], unknown>> = {};
    let hasCurrentBackgroundValue = false;

    for (const property of BACKGROUND_SOURCE_PROPERTIES) {
        const value = read(scope, property);
        backgroundValues[property] = value;
        hasCurrentBackgroundValue ||= value !== undefined;
    }

    if (!hasCurrentBackgroundValue) return [];

    for (const property of BACKGROUND_SOURCE_PROPERTIES) {
        const valueNormalizer =
            property === 'backgroundImage'
                ? {
                      type: 'background-image' as const,
                      assetBaseUrl: scope.input.assetBaseUrl,
                      fallbackValue: 'none',
                  }
                : BACKGROUND_EMPTY_FALLBACKS[property];
        const effectiveValue = readEffective(
            scope,
            property,
            'style',
            valueNormalizer,
            BACKGROUND_RUNTIME_VALIDATION_PROPERTIES[property]
        );
        if (effectiveValue !== undefined) {
            backgroundStyle[property] = effectiveValue;
        }
    }

    if (isStyleDynamicVariableReference(backgroundStyle.backgroundColor)) {
        return [
            {
                property: 'background',
                value: getCompiledBackgroundShorthand(backgroundStyle, scope.input.assetBaseUrl),
            },
        ];
    }

    // Legacy projects can store a color token in `backgroundGradient`. The old inline `background`
    // shorthand accepted either the resolved color or a real gradient, while `background-image`
    // becomes invalid at computed-value time when the token resolves to a color. Keep the
    // shorthand grammar when this is the only effective layer so both historical value kinds
    // remain valid without guessing what a custom property resolves to.
    if (backgroundStyle.backgroundGradient && !backgroundStyle.backgroundColor && !backgroundStyle.backgroundImage) {
        return [
            {
                property: 'background',
                value: getCompiledBackgroundShorthand(backgroundStyle, scope.input.assetBaseUrl),
            },
        ];
    }

    return getCompiledBackgroundDeclarations(backgroundStyle, scope.input.assetBaseUrl)
        .filter(declaration => shouldEmitBackgroundDeclaration(declaration.requiredSlotProperties, backgroundValues))
        .map(({ property, value }) => ({ property, value }));
}

/**
 * Emits default background declarations and responsive declarations whose contributing source
 * properties changed at the current breakpoint. CSS then handles inherited longhands natively.
 */
function shouldEmitBackgroundDeclaration(
    requiredSlotProperties: readonly string[],
    backgroundValues: Partial<Record<(typeof BACKGROUND_SOURCE_PROPERTIES)[number], unknown>>
) {
    for (const property of requiredSlotProperties) {
        const value = backgroundValues[property];
        if (value === undefined) continue;
        return true;
    }

    return false;
}

/**
 * Creates grid child declarations, including legacy span property fallbacks.
 */
function createGridChildDeclarations(scope: DeclarationScope) {
    if (!shouldEmitStyleProperty(scope, 'gridColumn') && !shouldEmitStyleProperty(scope, 'gridRow')) return [];

    return [
        shouldEmitStyleProperty(scope, 'gridColumn')
            ? createGridPlacementDeclaration(scope, 'gridColumn', 'columnSpan')
            : null,
        shouldEmitStyleProperty(scope, 'gridRow') ? createGridPlacementDeclaration(scope, 'gridRow', 'rowSpan') : null,
    ];
}

function createGridPlacementDeclaration(scope: DeclarationScope, property: string, spanProperty: string) {
    const placementNormalizer = { type: 'empty-if-falsy' } as const satisfies StyleCssValueNormalizer;
    const spanNormalizer = {
        type: 'prefix-if-truthy',
        prefix: 'span ',
    } as const satisfies StyleCssValueNormalizer;
    const placement = read(scope, property, 'style', placementNormalizer);
    const normalizedPlacement = isStyleDynamicVariableReference(placement)
        ? placement
        : normalizeStyleRuntimeValue(placement, placementNormalizer);

    // A configured static placement is authoritative. Its legacy span must not register a runtime
    // dependency that can later overwrite the declaration.
    if (!isStyleDynamicVariableReference(normalizedPlacement) && normalizedPlacement) {
        return createDeclaration(scope, property, normalizedPlacement);
    }

    const span = resolveRawStyleProperty({
        input: scope.input,
        source: scope.source,
        property: spanProperty,
        state: scope.state,
        breakpoint: scope.breakpoint,
        slot: scope.slot('style'),
        domain: 'style',
    });
    const normalizedSpan = isDynamicValue(span) ? span : normalizeStyleRuntimeValue(span, spanNormalizer);

    if (!isStyleDynamicVariableReference(normalizedPlacement) && !isDynamicValue(normalizedSpan)) {
        return createDeclaration(scope, property, normalizedSpan);
    }

    return createDeclaration(
        scope,
        property,
        createWhenEmptyDynamicCssVariableReference({
            input: scope.input,
            surface: scope.surface,
            sourceUid: scope.source.uid(),
            domain: 'style',
            property,
            state: scope.state,
            breakpoint: scope.breakpoint,
            value: isStyleDynamicVariableReference(normalizedPlacement)
                ? normalizedPlacement.variable.value
                : normalizedPlacement,
            valueNormalizer: placementNormalizer,
            runtimeFallback: {
                type: 'when-empty',
                value: span,
                valueNormalizer: spanNormalizer,
            },
        })
    );
}

function shouldEmitStyleProperty(scope: DeclarationScope, property: string) {
    return !isStylePropertyDeclarationDisabled(scope.source, property);
}

function shouldEmitTextProperty(scope: DeclarationScope, property: string) {
    return !isInheritedStylePropertyExcluded(scope.source, 'ww-text', property);
}

function readTextProperty(scope: DeclarationScope, property: string, valueNormalizer?: StyleCssValueNormalizer) {
    return read(scope, property, 'content', valueNormalizer);
}

function getTextPropertyOrigin(scope: DeclarationScope, property: string) {
    return resolveStylePropertyOrigin({
        input: scope.input,
        source: scope.source,
        property,
        state: scope.state,
        breakpoint: scope.breakpoint,
        slot: scope.slot('content'),
        domain: 'content',
    });
}

function shouldEmitTextLonghand(
    scope: DeclarationScope,
    property: string,
    fontOrigin: StylePropertyOrigin | undefined,
    font: unknown
) {
    if (!fontOrigin) return true;

    const longhandOrigin = getTextPropertyOrigin(scope, property);
    if (!longhandOrigin) return true;
    if (longhandOrigin.kind === 'source') return true;

    const isTypographyToken = typeof font === 'string' && font.trimStart().startsWith('var(');
    return (
        longhandOrigin.precedence > fontOrigin.precedence ||
        (isTypographyToken && longhandOrigin.precedence === fontOrigin.precedence)
    );
}

function hasResolvedValue(value: unknown) {
    return value !== undefined && value !== null && value !== '';
}

/**
 * Normalizes raw display data to a valid CSS display value.
 */
function getDisplayValue(
    displayValue: unknown,
    allowedValues: readonly string[] = DEFAULT_DISPLAY_VALUES,
    restrictToAllowedValues = false
) {
    if (isDynamicCssVariableReference(displayValue)) return displayValue;

    return normalizeDisplayValue(displayValue, allowedValues, restrictToAllowedValues);
}

function getExplicitComponentSize(size: unknown) {
    if (!size || size === 'auto') return undefined;

    return size;
}

/**
 * Returns whether a value looks like a non-zero CSS length.
 */
function hasNonZeroLength(value: unknown) {
    if (!value) return false;

    const length = parseFloat(`${value}`);
    return Number.isFinite(length) && length !== 0;
}
