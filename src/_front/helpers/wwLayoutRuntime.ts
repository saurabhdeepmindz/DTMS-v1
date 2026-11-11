import { computed, inject, useAttrs, type CSSProperties, type ComputedRef } from 'vue';

import { getLayoutStyleFromContent } from './wwLayoutStyle';

type LayoutRuntimeInput = {
    enabled: boolean;
    display: unknown;
    textAlign: unknown;
    isElementRoot?: boolean;
};

type LayoutItemStyleInput = {
    index: number;
    length: number;
    flexDirection: unknown;
    reverse: unknown;
    pushLast: unknown;
};

export type ComponentLayoutRuntime = {
    inheritsLayout: boolean;
    display: () => unknown;
    textAlign: () => unknown;
    rawDisplay?: () => unknown;
    displayValue?: () => unknown;
    rawTextAlign?: () => unknown;
};

const PUSH_LAST_STYLE_VERTICAL: CSSProperties = { marginTop: 'auto' };
const PUSH_LAST_STYLE_HORIZONTAL: CSSProperties = { marginLeft: 'auto' };

/**
 * Resolves the two legacy block-only layout properties at the rendered layout seam.
 */
export function createLayoutRuntimeStyle({
    enabled,
    display,
    textAlign,
    isElementRoot = false,
}: LayoutRuntimeInput): CSSProperties {
    if (!enabled || !isLegacyBlockDisplay(display)) return {};

    const style: CSSProperties = isElementRoot ? {} : { height: '100%' };
    if (textAlign) style.textAlign = textAlign as CSSProperties['textAlign'];

    return style;
}

/**
 * Resolves the inherited layout bridge only when the host and active display family need it.
 */
export function createInheritedLayoutRuntimeStyle(
    componentLayoutRuntime: ComponentLayoutRuntime | undefined,
    isElementRoot = false
): CSSProperties {
    if (!componentLayoutRuntime?.inheritsLayout) return {};

    const display = componentLayoutRuntime.display();
    if (!isLegacyBlockDisplay(display)) return {};

    return createLayoutRuntimeStyle({
        enabled: true,
        display,
        textAlign: componentLayoutRuntime.textAlign(),
        isElementRoot,
    });
}

/**
 * Preserves the full legacy helper for wwSimpleLayout and public coded-component layout roots.
 */
export function useLegacyLayoutStyle(): ComputedRef<CSSProperties> {
    const componentContent = inject<Record<string, unknown>>('componentContent', {});
    const componentLayoutRuntime = inject<ComponentLayoutRuntime | undefined>('componentLayoutRuntime', undefined);
    const attrs = useAttrs();

    return computed(() => {
        const display = componentLayoutRuntime?.display();
        const style = getLayoutStyleFromContent(componentContent, {
            display,
            textAlign: isLegacyBlockDisplay(display) ? componentLayoutRuntime?.textAlign() : undefined,
        });
        if (hasElementLayoutRootClass(attrs.class)) delete style.height;

        return style;
    });
}

function isLegacyBlockDisplay(display: unknown) {
    return display === 'block' || display === 'inline-block';
}

export function hasElementLayoutRootClass(value: unknown): boolean {
    if (typeof value === 'string') return value.split(/\s+/).includes('ww-element');
    if (Array.isArray(value)) return value.some(hasElementLayoutRootClass);
    if (!value || typeof value !== 'object') return false;

    return !!(value as Record<string, unknown>)['ww-element'];
}

/**
 * Preserves the legacy logical-item push-last contract, including conditionally hidden items and
 * custom slots consuming `itemStyle` themselves.
 */
export function createLayoutItemStyle({
    index,
    length,
    flexDirection,
    reverse,
    pushLast,
}: LayoutItemStyleInput): CSSProperties | undefined {
    if (!pushLast) return undefined;

    const shouldPush = reverse ? index === 0 : index === length - 1;
    if (!shouldPush) return undefined;

    if (flexDirection === 'column') return PUSH_LAST_STYLE_VERTICAL;

    return PUSH_LAST_STYLE_HORIZONTAL;
}
