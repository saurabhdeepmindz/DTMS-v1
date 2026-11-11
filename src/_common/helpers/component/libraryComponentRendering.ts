import type { ComputedRef } from 'vue';

type LibraryComponentRenderingData = {
    rendering?: {
        conditionalRendering?: {
            raw?: unknown;
            value?: unknown;
        };
    };
    layout?: Partial<Record<LibraryComponentLayoutProperty, LibraryComponentLayoutValue>>;
};

type LibraryComponentLayoutProperty = 'display' | 'textAlign';

type LibraryComponentLayoutValue = {
    raw?: () => unknown;
    value?: () => unknown;
};

type LibraryComponentLayoutValueSource = {
    raw: () => unknown;
    value: () => unknown;
};

export function createLibraryComponentRenderingData({
    raw,
    value,
}: {
    raw: ComputedRef<unknown>;
    value: ComputedRef<unknown>;
}) {
    return {
        rendering: {
            conditionalRendering: { raw, value },
        },
    };
}

export function createLibraryComponentLayoutData({
    display,
    textAlign,
}: {
    display: LibraryComponentLayoutValueSource;
    textAlign: LibraryComponentLayoutValueSource;
}) {
    return {
        layout: {
            display,
            textAlign,
        },
    };
}

export function resolveLibraryComponentConditionalRendering(
    libraryComponentData: LibraryComponentRenderingData | null | undefined,
    fallback: () => unknown
) {
    const conditionalRendering = libraryComponentData?.rendering?.conditionalRendering;
    if (conditionalRendering?.raw === undefined || conditionalRendering.value === undefined) {
        return fallback();
    }

    return conditionalRendering.value;
}

export function resolveLibraryComponentLayoutValue(
    libraryComponentData: LibraryComponentRenderingData | null | undefined,
    property: LibraryComponentLayoutProperty,
    fallback: () => unknown
) {
    const resolved = resolveLibraryComponentLayoutEntry(libraryComponentData, property);
    if (!resolved) return fallback();

    return resolved.value;
}

export function resolveLibraryComponentRawLayoutValue(
    libraryComponentData: LibraryComponentRenderingData | null | undefined,
    property: LibraryComponentLayoutProperty,
    fallback: () => unknown
) {
    const resolved = resolveLibraryComponentLayoutEntry(libraryComponentData, property);
    if (!resolved) return fallback();

    return resolved.raw;
}

function resolveLibraryComponentLayoutEntry(
    libraryComponentData: LibraryComponentRenderingData | null | undefined,
    property: LibraryComponentLayoutProperty
) {
    const source = libraryComponentData?.layout?.[property];
    if (!source?.raw || !source.value) return null;

    const raw = source.raw();
    const value = source.value();
    if (raw === undefined || value === undefined) return null;

    return { raw, value };
}
