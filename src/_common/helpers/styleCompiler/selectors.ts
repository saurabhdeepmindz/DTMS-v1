import { escapeCssIdentifier, escapeCssString } from './serialization';
import { encodeDenseStyleSourceId } from './sourceIds';
import type {
    StyleElementReader,
    StyleLibraryLayer,
    StyleRuleGroup,
    StyleSectionReader,
    StyleSurface,
    StyleSurfaceKind,
} from './types';

type ElementSurfaceOptions = {
    key?: string;
    selector?: string;
    layoutSelector?: string;
    runtimeScopeSelector?: string;
    libraryLayer?: StyleLibraryLayer;
};

const BASE64_URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_NON_UUID_STYLE_SOURCE_ID_CACHE_SIZE = 8_192;
const NON_UUID_STYLE_SOURCE_ID_CACHE = new Map<string, string>();

/**
 * Encodes a persistent style source identity as a compact, collision-free DOM token.
 *
 * UUIDs use their 128-bit representation instead of their 36-character text form. Historical and
 * transient non-UUID identities use a lossless Unicode fallback. The discriminator keeps the UUID,
 * well-formed UTF-8, and isolated-surrogate domains disjoint without requiring a manifest or
 * allocated identifiers.
 */
export function encodeStyleSourceId(uid: string, persistedId?: unknown) {
    if (typeof persistedId === 'number') {
        const denseId = encodeDenseStyleSourceId(persistedId);
        if (denseId) return denseId;
    }

    if (UUID_PATTERN.test(uid)) {
        const hex = uid.replaceAll('-', '');
        const bytes = new Uint8Array(16);

        for (let index = 0; index < bytes.length; index++) {
            bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
        }

        return `u${encodeBase64Url(bytes)}`;
    }

    const cached = NON_UUID_STYLE_SOURCE_ID_CACHE.get(uid);
    if (cached) return cached;

    const encoded = hasUnpairedSurrogate(uid)
        ? `w${encodeUtf16Base64Url(uid)}`
        : `s${encodeBase64Url(new TextEncoder().encode(uid))}`;
    if (NON_UUID_STYLE_SOURCE_ID_CACHE.size < MAX_NON_UUID_STYLE_SOURCE_ID_CACHE_SIZE) {
        NON_UUID_STYLE_SOURCE_ID_CACHE.set(uid, encoded);
    }
    return encoded;
}

function hasUnpairedSurrogate(value: string) {
    for (let index = 0; index < value.length; index++) {
        const codeUnit = value.charCodeAt(index);
        if (codeUnit < 0xd800 || codeUnit > 0xdfff) continue;

        if (codeUnit <= 0xdbff) {
            const nextCodeUnit = value.charCodeAt(index + 1);
            if (nextCodeUnit >= 0xdc00 && nextCodeUnit <= 0xdfff) {
                index++;
                continue;
            }
        }

        return true;
    }

    return false;
}

function encodeUtf16Base64Url(value: string) {
    const bytes = new Uint8Array(value.length * 2);

    for (let index = 0; index < value.length; index++) {
        const codeUnit = value.charCodeAt(index);
        bytes[index * 2] = codeUnit >> 8;
        bytes[index * 2 + 1] = codeUnit & 0xff;
    }

    return encodeBase64Url(bytes);
}

function encodeBase64Url(bytes: Uint8Array) {
    let encoded = '';

    for (let index = 0; index < bytes.length; index += 3) {
        const first = bytes[index];
        const second = bytes[index + 1];
        const third = bytes[index + 2];

        encoded += BASE64_URL_ALPHABET[first >> 2];
        encoded += BASE64_URL_ALPHABET[((first & 0b00000011) << 4) | ((second ?? 0) >> 4)];
        if (second !== undefined) {
            encoded += BASE64_URL_ALPHABET[((second & 0b00001111) << 2) | ((third ?? 0) >> 6)];
        }
        if (third !== undefined) encoded += BASE64_URL_ALPHABET[third & 0b00111111];
    }

    return encoded;
}

/**
 * Creates the compiler-owned class applied to rendered element surfaces.
 */
export function createElementClassName(uid: string, persistedId?: unknown) {
    return `ww-e-${encodeStyleSourceId(uid, persistedId)}`;
}

/**
 * Creates the default selector for an element surface.
 */
export function createElementSelector(uid: string, persistedId?: unknown) {
    return `.${escapeCssIdentifier(createElementClassName(uid, persistedId))}`;
}

/**
 * Creates selectors for layout CSS owned by an element source.
 *
 * `wwLayout` can be the component root or an internal layout node inside a custom/coded component.
 * Internal layouts expose every renderless root/instance scope that owns them. The token selector
 * prevents an element from styling layouts owned by child elements.
 */
export function createElementLayoutSelector(uid: string, selector?: string, persistedId?: unknown) {
    const ownerSelector = selector || createElementSelector(uid, persistedId);
    return `${appendCssSelector(ownerSelector, '.ww-layout')},\n${createElementDescendantLayoutSelector(uid, ownerSelector, persistedId)}`;
}

/**
 * Creates selectors for internal layout nodes owned by an element source.
 */
export function createElementDescendantLayoutSelector(uid: string, selector?: string, persistedId?: unknown) {
    const ownerSelector = selector || createElementSelector(uid, persistedId);
    const scopedLayoutSelector = `[data-ww-ls~="${escapeCssString(encodeStyleSourceId(uid, persistedId))}"]`;

    return splitCssSelectorList(ownerSelector)
        .map(selectorPart => `${selectorPart} ${scopedLayoutSelector}`)
        .join(',\n');
}

/**
 * Creates the default selector for a section container surface.
 */
export function createSectionContainerSelector(uid: string, persistedId?: unknown) {
    return `.${escapeCssIdentifier(createSectionClassName(uid, persistedId))}`;
}

/**
 * Creates the compiler-owned class applied to rendered section containers.
 */
export function createSectionClassName(uid: string, persistedId?: unknown) {
    return `ww-s-${encodeStyleSourceId(uid, persistedId)}`;
}

/**
 * Creates the default selector for a section inner element surface.
 */
export function createSectionElementSelector(uid: string, persistedId?: unknown) {
    return `${createSectionContainerSelector(uid, persistedId)} > .ww-section-element`;
}

/**
 * Creates selectors for layout CSS owned by a section source.
 */
export function createSectionLayoutSelector(uid: string, persistedId?: unknown) {
    const sectionElementSelector = createSectionElementSelector(uid, persistedId);

    return `${sectionElementSelector}.ww-layout`;
}

/**
 * Appends a suffix to each selector in a comma-separated selector list.
 */
export function appendCssSelector(selector: string, suffix: string) {
    return splitCssSelectorList(selector)
        .map(selectorPart => `${selectorPart}${suffix}`)
        .join(',\n');
}

/**
 * Keeps selector matching intact while removing its specificity contribution.
 *
 * This is useful for behavioral rules whose precedence is owned by compiler source order rather
 * than by the shape of a state, library definition, or instance selector.
 */
export function zeroCssSelectorSpecificity(selector: string) {
    return splitCssSelectorList(selector)
        .map(selectorPart => `:where(${selectorPart})`)
        .join(',\n');
}

/**
 * Splits a CSS selector list on top-level commas only.
 *
 * Selectors can contain commas inside functional pseudo-classes or attribute values, for example
 * `:is(.a, .b)` or `[data-label=","]`. The runtime stylesheet uses this when replacing the static
 * source selector with a mounted instance selector.
 */
export function splitCssSelectorList(selector: string) {
    const parts: string[] = [];
    let currentPart = '';
    let quote: '"' | "'" | null = null;
    let isEscaped = false;
    let bracketDepth = 0;
    let parenthesisDepth = 0;

    for (const char of selector) {
        if (isEscaped) {
            currentPart += char;
            isEscaped = false;
            continue;
        }

        if (char === '\\') {
            currentPart += char;
            isEscaped = true;
            continue;
        }

        if (quote) {
            currentPart += char;
            if (char === quote) quote = null;
            continue;
        }

        if (char === '"' || char === "'") {
            quote = char;
            currentPart += char;
            continue;
        }

        if (char === '[') {
            bracketDepth++;
        } else if (char === ']') {
            bracketDepth = Math.max(0, bracketDepth - 1);
        } else if (char === '(') {
            parenthesisDepth++;
        } else if (char === ')') {
            parenthesisDepth = Math.max(0, parenthesisDepth - 1);
        } else if (char === ',' && bracketDepth === 0 && parenthesisDepth === 0) {
            addSelectorPart(parts, currentPart);
            currentPart = '';
            continue;
        }

        currentPart += char;
    }

    addSelectorPart(parts, currentPart);
    return parts;
}

function addSelectorPart(parts: string[], selectorPart: string) {
    const trimmedPart = selectorPart.trim();
    if (trimmedPart) parts.push(trimmedPart);
}

/**
 * Builds an element style surface from an element reader.
 */
export function createElementStyleSurface(
    source: StyleElementReader,
    group: StyleRuleGroup,
    options: ElementSurfaceOptions = {}
): StyleSurface {
    const uid = source.uid();
    const persistedId = source.styleSourceId?.();
    const selector = options.selector || source.selector?.() || createElementSelector(uid, persistedId);

    return {
        key: options.key || `element:${uid}`,
        group,
        kind: 'element',
        selector,
        runtimeScopeSelector: options.runtimeScopeSelector || selector,
        libraryLayer: options.libraryLayer,
    };
}

/**
 * Builds an element-owned layout surface from an element reader.
 */
export function createElementLayoutStyleSurface(
    source: StyleElementReader,
    group: StyleRuleGroup,
    options: ElementSurfaceOptions = {}
): StyleSurface {
    const uid = source.uid();
    const persistedId = source.styleSourceId?.();

    return {
        key: options.key ? `${options.key}:layout` : `element-layout:${uid}`,
        group,
        kind: 'element-layout',
        selector: options.layoutSelector || createElementLayoutSelector(uid, options.selector, persistedId),
        runtimeScopeSelector: options.runtimeScopeSelector || createElementSelector(uid, persistedId),
        libraryLayer: options.libraryLayer,
    };
}

/**
 * Builds a section style surface from a section reader and a section DOM surface.
 */
export function createSectionStyleSurface(
    source: StyleSectionReader,
    kind: Extract<StyleSurfaceKind, 'section-container' | 'section-element'>,
    group: StyleRuleGroup
): StyleSurface {
    const uid = source.uid();
    const persistedId = source.styleSourceId?.();
    const defaultSelector =
        kind === 'section-container'
            ? createSectionContainerSelector(uid, persistedId)
            : createSectionElementSelector(uid, persistedId);
    const selector = source.selector?.() || defaultSelector;

    return {
        key: `${kind}:${uid}`,
        group,
        kind,
        selector,
        runtimeScopeSelector: selector,
    };
}

/**
 * Builds a section-owned layout surface from a section reader.
 */
export function createSectionLayoutStyleSurface(source: StyleSectionReader, group: StyleRuleGroup): StyleSurface {
    const uid = source.uid();
    const persistedId = source.styleSourceId?.();

    return {
        key: `section-layout:${uid}`,
        group,
        kind: 'section-layout',
        selector: createSectionLayoutSelector(uid, persistedId),
        runtimeScopeSelector: createSectionElementSelector(uid, persistedId),
    };
}

/**
 * Resolves the selector used for a parent state.
 */
export function resolveParentSelector(parentUid: string, source: StyleElementReader | StyleSectionReader) {
    const parentRef = source.parentRef();
    if (parentRef?.uid === parentUid && parentRef.selector) return parentRef.selector;

    return createElementSelector(parentUid, parentRef?.uid === parentUid ? parentRef.styleSourceId : undefined);
}
