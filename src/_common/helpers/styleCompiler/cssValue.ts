import type {
    StyleCssValueMap,
    StyleCssValueNormalizer,
    StyleDeclarationPriority,
    StyleDynamicVariableReference,
} from './types';
import { STYLE_DYNAMIC_VARIABLE_REFERENCE } from './types';
import { mapStyleValue, normalizeStyleRuntimeValue } from './valueNormalization';

const LENGTH_LIKE_CSS_PROPERTIES = new Set([
    'background-position-x',
    'background-position-y',
    'background-size',
    'border',
    'border-bottom',
    'border-bottom-left-radius',
    'border-bottom-right-radius',
    'border-bottom-width',
    'border-left',
    'border-left-width',
    'border-radius',
    'border-right',
    'border-right-width',
    'border-spacing',
    'border-top',
    'border-top-left-radius',
    'border-top-right-radius',
    'border-top-width',
    'bottom',
    'column-gap',
    'flex-basis',
    'font-size',
    'gap',
    'height',
    'left',
    'letter-spacing',
    'line-height',
    'margin',
    'margin-bottom',
    'margin-left',
    'margin-right',
    'margin-top',
    'max-height',
    'max-width',
    'min-height',
    'min-width',
    'outline-offset',
    'outline-width',
    'padding',
    'padding-bottom',
    'padding-left',
    'padding-right',
    'padding-top',
    'perspective',
    'right',
    'row-gap',
    'text-indent',
    'top',
    'width',
    'word-spacing',
]);

const UNITLESS_CSS_PROPERTIES = new Set([
    'animation-iteration-count',
    'column-count',
    'flex',
    'flex-grow',
    'flex-shrink',
    'font-weight',
    'grid-column',
    'grid-column-end',
    'grid-column-start',
    'grid-row',
    'grid-row-end',
    'grid-row-start',
    'line-height',
    'opacity',
    'order',
    'orphans',
    'scale',
    'tab-size',
    'widows',
    'z-index',
    'zoom',
]);

const LEGACY_IMPORTANT_SUFFIX = /\s*!\s*important\s*$/i;
const UNSAFE_RUNTIME_CSS_VALUE_CHARACTERS = /[\u0000-\u0008\u000b\u000e-\u001f{};]/;

/**
 * Reproduces Vue's legacy inline-style handling without changing CSSOM setProperty semantics.
 * Custom properties stay untouched because priority on their declaration does not propagate to
 * properties consuming them through var().
 */
export function splitLegacyCssPriority(
    cssProperty: string,
    cssValue: string
): { value: string; priority: StyleDeclarationPriority } {
    if (cssProperty.startsWith('--')) {
        return { value: cssValue, priority: '' };
    }

    const value = cssValue.replace(LEGACY_IMPORTANT_SUFFIX, '');
    if (value === cssValue) {
        return { value: cssValue, priority: '' };
    }

    return { value, priority: 'important' };
}

/**
 * Normalizes a JS-style property name into a CSS property name.
 */
export function normalizeCssProperty(property: string) {
    if (property.startsWith('--')) return property;
    return property.replace(/[A-Z]/g, char => `-${char.toLowerCase()}`);
}

/**
 * Converts a supported WeWeb value into CSS text.
 *
 * Grammar validation belongs to the stylesheet adapter's CSSOM implementation.
 */
export function serializeCssValue(value: unknown) {
    if (value === undefined || value === null || value === '') return undefined;

    if (isStyleDynamicVariableReference(value)) return value.cssText;

    if (typeof value === 'number') {
        return Number.isFinite(value) ? `${value}` : undefined;
    }

    if (typeof value !== 'string') return undefined;

    const trimmedValue = value.trim();
    if (!trimmedValue) return undefined;

    return trimmedValue;
}

/**
 * Serializes a formula value for the CSS property that consumes its generated variable.
 */
export function serializeRuntimeCssVariableValue(
    cssProperty: string,
    value: unknown,
    options: { valueMap?: StyleCssValueMap; valueNormalizer?: StyleCssValueNormalizer } = {}
) {
    const cssValue = options.valueNormalizer
        ? normalizeStyleRuntimeValue(value, options.valueNormalizer)
        : options.valueMap
          ? mapStyleValue(value, options.valueMap)
          : value;
    if (options.valueNormalizer?.type === 'background-image' && isQuotedCssUrl(cssValue)) return cssValue.trim();
    if (typeof cssValue !== 'number') return serializeRuntimeCssValue(cssValue);
    if (!Number.isFinite(cssValue)) return undefined;

    const normalizedProperty = normalizeCssProperty(cssProperty);
    if (normalizedProperty.startsWith('--')) return `${cssValue}`;
    if (UNITLESS_CSS_PROPERTIES.has(normalizedProperty)) return `${cssValue}`;
    if (LENGTH_LIKE_CSS_PROPERTIES.has(normalizedProperty)) return `${cssValue}px`;

    return `${cssValue}`;
}

/**
 * Runtime variables are written into a shared custom-property rule, so keep declaration/rule
 * delimiters out of that transport before the browser CSSOM mutation occurs. CSS whitespace
 * (tab, line feed, form feed, and carriage return) remains valid inside declaration values.
 */
function serializeRuntimeCssValue(value: unknown) {
    const cssValue = serializeCssValue(value);
    if (!cssValue) return undefined;
    if (UNSAFE_RUNTIME_CSS_VALUE_CHARACTERS.test(cssValue) || /<\/style/i.test(cssValue)) return undefined;
    return cssValue;
}

function isQuotedCssUrl(value: unknown): value is string {
    if (typeof value !== 'string') return false;

    return /^url\((?:"(?:\\.|[^"\\\r\n])*"|'(?:\\.|[^'\\\r\n])*')\)$/i.test(value.trim());
}

function isStyleDynamicVariableReference(value: unknown): value is StyleDynamicVariableReference {
    return !!(
        value &&
        typeof value === 'object' &&
        (value as Partial<StyleDynamicVariableReference>)[STYLE_DYNAMIC_VARIABLE_REFERENCE] === true
    );
}
