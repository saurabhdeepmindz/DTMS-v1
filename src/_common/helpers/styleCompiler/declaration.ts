import type { StyleBreakpointName } from './breakpoints';
import { DEFAULT_DISPLAY_VALUES } from './capabilities';
import {
    isStyleDynamicVariableReference,
    resolveEffectiveStyleProperty,
    resolveEffectiveStylePropertyWithSource,
    resolveStyleProperty,
    type StyleSlotContext,
} from './values';
import type {
    StyleCompilerInput,
    StyleCssValueNormalizer,
    StyleElementReader,
    StylePropertyDomain,
    StyleSectionReader,
    StyleSurface,
} from './types';

/** Everything a declaration resolver needs at one rendered surface, state, and breakpoint. */
export type DeclarationScope = {
    input: StyleCompilerInput;
    surface: StyleSurface;
    selector: string;
    source: StyleElementReader | StyleSectionReader;
    state: string;
    breakpoint: StyleBreakpointName;
    emitDefaultDeclarations: boolean;
    slot(domain: StylePropertyDomain): StyleSlotContext;
};

/** Resolves one related group of WeWeb properties into CSS declarations. */
export type StyleDeclarationResolver = (scope: DeclarationScope) => Array<CompiledStyleDeclaration | null>;

/** One compiled CSS declaration before serialization. */
export type CompiledStyleDeclaration = {
    property: string;
    value: unknown;
    isDefault?: boolean;
    rule?: CompiledStyleRuleTarget;
};

/** Optional rule target for declarations emitted outside the current surface rule. */
export type CompiledStyleRuleTarget = {
    keySuffix: string;
    selector: string;
    layer?: 'layout-override';
    mediaQuery?: string;
};

export function createDeclaration(
    scope: DeclarationScope,
    property: string,
    value: unknown,
    defaultValue?: unknown,
    rule?: CompiledStyleRuleTarget
): CompiledStyleDeclaration | null {
    const hasDefaultValue = defaultValue !== undefined;
    if (value === undefined && (!hasDefaultValue || !shouldEmitDefaultDeclaration(scope))) return null;

    const isDefault = value === undefined;
    const declarationValue = isDefault ? defaultValue : value;
    if (declarationValue === undefined || declarationValue === null || declarationValue === '') return null;

    return { property, value: declarationValue, isDefault, rule };
}

/**
 * Creates a declaration from one persisted state and breakpoint slot.
 *
 * The legacy inline renderer treated `null` and an empty string as explicit values: they removed
 * the current inline declaration instead of inheriting the broader WeWeb slot. CSS keeps broader
 * state and breakpoint rules in the cascade, so non-base slots need an explicit layer reset to
 * preserve that removal. A clear in the base/default slot remains transparent to lower layers.
 */
export function createAuthoredStyleDeclaration(
    scope: DeclarationScope,
    property: string,
    value: unknown,
    defaultValue?: unknown,
    rule?: CompiledStyleRuleTarget
) {
    const isExplicitClear = value === null || value === '';
    const needsCascadeReset = isExplicitClear && (scope.state !== 'base' || scope.breakpoint !== 'default');

    return createDeclaration(scope, property, needsCascadeReset ? 'revert-layer' : value, defaultValue, rule);
}

export function shouldEmitDefaultDeclaration(scope: DeclarationScope) {
    return scope.emitDefaultDeclarations && scope.state === 'base' && scope.breakpoint === 'default';
}

export function readStyleValue(
    scope: DeclarationScope,
    property: string,
    domain: StylePropertyDomain = 'style',
    valueNormalizer?: StyleCssValueNormalizer
) {
    return resolveStyleProperty({
        input: scope.input,
        surface: scope.surface,
        source: scope.source,
        property,
        state: scope.state,
        breakpoint: scope.breakpoint,
        slot: scope.slot(domain),
        domain,
        valueNormalizer,
    });
}

export function readDisplayValue(
    scope: DeclarationScope,
    allowedValues: readonly string[],
    restrictToAllowedValues: boolean
) {
    const display = resolveStyleProperty({
        input: scope.input,
        surface: scope.surface,
        source: scope.source,
        property: 'display',
        state: scope.state,
        breakpoint: scope.breakpoint,
        slot: scope.slot('style'),
        valueNormalizer: { type: 'display', allowedValues, restrictToAllowedValues },
    });

    if (isStyleDynamicVariableReference(display) && scope.source.capabilities?.().omitUndefinedDynamicValues) {
        return display.withCssFallback(allowedValues[0] || DEFAULT_DISPLAY_VALUES[0]);
    }

    return display;
}

export function readEffectiveStyleValue(
    scope: DeclarationScope,
    property: string,
    domain: StylePropertyDomain = 'style',
    valueNormalizer?: StyleCssValueNormalizer,
    validationProperty?: string
) {
    return resolveEffectiveStyleProperty({
        input: scope.input,
        surface: scope.surface,
        source: scope.source,
        property,
        state: scope.state,
        breakpoint: scope.breakpoint,
        slot: scope.slot(domain),
        domain,
        valueNormalizer,
        validationProperty,
    });
}

export function readEffectiveStyleValueWithSourceFallback(
    scope: DeclarationScope,
    property: string,
    domain: StylePropertyDomain = 'style',
    valueNormalizer?: StyleCssValueNormalizer
) {
    return resolveEffectiveStyleProperty({
        input: scope.input,
        surface: scope.surface,
        source: scope.source,
        property,
        state: scope.state,
        breakpoint: scope.breakpoint,
        slot: scope.slot(domain),
        domain,
        valueNormalizer,
        includeSourceFallback: true,
    });
}

export function readEffectiveStyleValueWithSourceFallbackResolution(
    scope: DeclarationScope,
    property: string,
    domain: StylePropertyDomain = 'style',
    valueNormalizer?: StyleCssValueNormalizer
) {
    return resolveEffectiveStylePropertyWithSource({
        input: scope.input,
        surface: scope.surface,
        source: scope.source,
        property,
        state: scope.state,
        breakpoint: scope.breakpoint,
        slot: scope.slot(domain),
        domain,
        valueNormalizer,
        includeSourceFallback: true,
    });
}
