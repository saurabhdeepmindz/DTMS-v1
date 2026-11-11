import type {
    StyleElementReader,
    StyleInheritanceCapability,
    StyleSectionReader,
} from './types';

/**
 * Historic generic element display fallback.
 */
export const DEFAULT_DISPLAY_VALUES = ['block', 'inline-block'] as const;

const VALID_DISPLAY_VALUES = new Set([
    'block',
    'inline',
    'inline-block',
    'flex',
    'inline-flex',
    'grid',
    'inline-grid',
    'flow-root',
    'contents',
    'list-item',
    'table',
    'inline-table',
    'table-caption',
    'table-cell',
    'table-column',
    'table-column-group',
    'table-footer-group',
    'table-header-group',
    'table-row',
    'table-row-group',
]);

/**
 * Returns normalized capabilities for a source.
 */
export function getStyleComponentCapabilities(source: StyleElementReader | StyleSectionReader) {
    return source.capabilities?.() || {};
}

/**
 * Returns true when the source inherits from a named WeWeb base component/configuration.
 */
export function sourceInherits(source: StyleElementReader | StyleSectionReader, type: string) {
    return !!getInheritedCapability(getStyleComponentCapabilities(source), type);
}

/**
 * Returns true when text content styles are valid for this source.
 */
export function sourceInheritsText(source: StyleElementReader | StyleSectionReader) {
    return sourceInherits(source, 'ww-text');
}

/**
 * Returns true when wwLayout content styles are valid for this source.
 */
export function sourceInheritsLayout(source: StyleElementReader | StyleSectionReader) {
    return sourceInherits(source, 'ww-layout');
}

/**
 * Returns true when a property is excluded from a named inheritance capability.
 */
export function isInheritedStylePropertyExcluded(
    source: StyleElementReader | StyleSectionReader,
    type: string,
    property: string
) {
    const capability = getInheritedCapability(getStyleComponentCapabilities(source), type);
    if (!capability || typeof capability === 'string') return false;
    if (!Array.isArray(capability.exclude)) return false;

    const normalizedProperty = normalizeInheritedPropertyName(property);
    return capability.exclude.some(excludedProperty => normalizeInheritedPropertyName(excludedProperty) === normalizedProperty);
}

/**
 * Returns display values allowed by the component, falling back to the old generic defaults.
 */
export function getAllowedDisplayValues(source: StyleElementReader | StyleSectionReader) {
    const allowedValues = getStyleComponentCapabilities(source).displayAllowedValues;
    if (!Array.isArray(allowedValues)) return DEFAULT_DISPLAY_VALUES;

    const normalizedValues = allowedValues
        .filter((value): value is string => typeof value === 'string')
        .map(value => value.toLowerCase());

    return normalizedValues.length ? normalizedValues : DEFAULT_DISPLAY_VALUES;
}

/**
 * Returns true when the source adapter provides component display constraints.
 */
export function hasConfiguredDisplayAllowedValues(source: StyleElementReader | StyleSectionReader) {
    return Array.isArray(getStyleComponentCapabilities(source).displayAllowedValues);
}

/**
 * Normalizes WeWeb display data to a valid CSS display value.
 *
 * WeWeb historically allowed boolean display bindings: `false`/`null` hides the source and `true`
 * falls back to the component default display.
 */
export function normalizeDisplayValue(
    displayValue: unknown,
    allowedValues: readonly string[] = DEFAULT_DISPLAY_VALUES,
    restrictToAllowedValues = false
) {
    if (displayValue === false || displayValue === null || displayValue === undefined) return 'none';

    if (typeof displayValue === 'string') {
        const normalizedDisplayValue = displayValue.toLowerCase();
        if (normalizedDisplayValue === 'none' || normalizedDisplayValue === 'false') return 'none';
        // Invalid display values are normalized to the first allowed value. Letting the browser
        // ignore invalid CSS would keep an old declaration active after data changes.
        if (
            VALID_DISPLAY_VALUES.has(normalizedDisplayValue) &&
            (!restrictToAllowedValues || allowedValues.includes(normalizedDisplayValue))
        ) {
            return normalizedDisplayValue;
        }
    }

    return allowedValues[0] || DEFAULT_DISPLAY_VALUES[0];
}

/**
 * Returns true when normal root declaration emission should skip this style property.
 */
export function isStylePropertyDeclarationDisabled(
    source: StyleElementReader | StyleSectionReader,
    property: string
) {
    const ignoredProperties = getStyleComponentCapabilities(source).ignoredStyleProperties;
    if (!ignoredProperties?.length) return false;
    if (ignoredProperties.includes(property)) return true;

    if (property.startsWith('background') && ignoredProperties.includes('background')) return true;
    if (isBorderProperty(property) && ignoredProperties.includes('border')) return true;
    if (property.startsWith('outline') && ignoredProperties.includes('outline')) return true;
    if (isPositionProperty(property) && ignoredProperties.includes('position')) return true;

    return false;
}

function getInheritedCapability(
    capabilities: ReturnType<typeof getStyleComponentCapabilities>,
    type: string
): StyleInheritanceCapability | undefined {
    return capabilities.inherits?.find(capability => {
        if (typeof capability === 'string') return capability === type;
        return capability?.type === type;
    });
}

function normalizeInheritedPropertyName(property: string) {
    return property.replace(/^_ww-(text|layout|grid|table)_/, '');
}

function isBorderProperty(property: string) {
    return property === 'borderRadius' || property.startsWith('border');
}

function isPositionProperty(property: string) {
    return ['position', 'top', 'right', 'bottom', 'left'].includes(property);
}
