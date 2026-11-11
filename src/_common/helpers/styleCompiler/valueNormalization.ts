import { normalizeDisplayValue } from './capabilities';
import type { StyleCssValueMap, StyleCssValueNormalizer } from './types';

/**
 * Maps a resolved source value to the final CSS value declared by component config.
 */
export function mapStyleValue(value: unknown, valueMap: StyleCssValueMap) {
    if (value === true) return valueMap.trueValue;
    if (value === false) return valueMap.falseValue;

    return undefined;
}

/**
 * Applies compiler-owned runtime value normalization before CSS serialization.
 */
export function normalizeStyleRuntimeValue(value: unknown, normalizer: StyleCssValueNormalizer) {
    if (normalizer.type === 'map') return mapStyleValue(value, normalizer.map);
    if (normalizer.type === 'empty-fallback') {
        return value === undefined || value === null || value === '' ? normalizer.fallbackValue : value;
    }
    if (normalizer.type === 'falsy-fallback') return value || normalizer.fallbackValue;
    if (normalizer.type === 'component-size') {
        return !value || value === 'auto' ? normalizer.fallbackValue : value;
    }
    if (normalizer.type === 'empty-if-falsy') return value || undefined;
    if (normalizer.type === 'prefix-if-truthy') return value ? `${normalizer.prefix}${value}` : undefined;
    if (normalizer.type === 'space-separated-list') {
        if (!Array.isArray(value)) return normalizer.fallbackValue;

        return value.join(' ') || normalizer.fallbackValue;
    }
    if (normalizer.type === 'display') {
        return normalizeDisplayValue(value, normalizer.allowedValues, normalizer.restrictToAllowedValues);
    }
    if (normalizer.type === 'background-image') {
        const backgroundImage = value || normalizer.fallbackValue;
        return normalizeBackgroundImageValue(backgroundImage, normalizer.assetBaseUrl);
    }

    return value;
}

/**
 * Converts legacy WeWeb image paths and URLs into a valid CSS `<image>` value.
 */
export function normalizeBackgroundImageValue(value: unknown, assetBaseUrl?: string) {
    if (typeof value !== 'string') return value;

    const trimmedValue = value.trim();
    if (!trimmedValue || trimmedValue === 'none') return trimmedValue;
    if (isCssImageFunction(trimmedValue)) return trimmedValue;

    const resolvedUrl = resolveAssetUrl(trimmedValue, assetBaseUrl);
    return `url('${escapeCssUrl(resolvedUrl)}')`;
}

function isCssImageFunction(value: string) {
    const cssImageFunction =
        /^(?:url|var|env|image|-webkit-image-set|(?:repeating-)?(?:linear|radial|conic)-gradient|image-set|cross-fade|element|paint)\(/i;

    return cssImageFunction.test(value);
}

function resolveAssetUrl(value: string, assetBaseUrl?: string) {
    if (!assetBaseUrl || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(value)) return value;

    return `${assetBaseUrl.replace(/\/+$/, '')}/${value.replace(/^\/+/, '')}`;
}

function escapeCssUrl(value: string) {
    return value
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/[\n\r\f]/g, '');
}
