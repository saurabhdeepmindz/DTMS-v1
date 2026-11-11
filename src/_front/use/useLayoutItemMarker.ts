import { computed, inject, provide, unref, type CSSProperties, type MaybeRef } from 'vue';

const LAYOUT_ITEM_INDEX_INJECTION_KEY = '_wwLayoutIndex';
const LAYOUT_ITEM_STYLE_INJECTION_KEY = '_wwLayoutItemStyle';

type LayoutItemIndex = MaybeRef<number | null>;
type LayoutItemStyle = MaybeRef<CSSProperties | undefined>;

export function provideLayoutItemIndex(index: LayoutItemIndex) {
    provide(LAYOUT_ITEM_INDEX_INJECTION_KEY, index);
}

export function resetLayoutItemIndex() {
    provideLayoutItemIndex(null);
}

export function provideLayoutItemStyle(style: LayoutItemStyle) {
    provide(LAYOUT_ITEM_STYLE_INJECTION_KEY, style);
}

export function resetLayoutItemStyle() {
    provideLayoutItemStyle(undefined);
}

export function useLayoutItemIndex() {
    return inject<LayoutItemIndex>(LAYOUT_ITEM_INDEX_INJECTION_KEY, null);
}

export function useLayoutItemStyle() {
    return inject<LayoutItemStyle>(LAYOUT_ITEM_STYLE_INJECTION_KEY, undefined);
}

/**
 * Returns the current item's runtime style and shields arbitrary descendants from inheriting it.
 */
export function consumeLayoutItemStyle() {
    const style = useLayoutItemStyle();
    resetLayoutItemStyle();
    return style;
}

export function useLayoutItemAttribute(index: LayoutItemIndex = useLayoutItemIndex()) {
    return computed(() => (unref(index) === null ? undefined : ''));
}
