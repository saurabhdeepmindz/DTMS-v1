import { computed, inject, provide, shallowRef, toValue } from 'vue';
import type { ComputedRef, InjectionKey, MaybeRefOrGetter, Ref } from 'vue';
import { encodeStyleSourceId } from '@/_common/helpers/styleCompiler';

type LayoutStyleScopeUid = string | null | undefined;
type LayoutStyleScopeUidsSource = Readonly<Ref<readonly string[]>>;
type LayoutStyleSourceId = number | null | undefined;

const EMPTY_LAYOUT_STYLE_SCOPE_UIDS: LayoutStyleScopeUidsSource = shallowRef([]);
const LAYOUT_STYLE_SCOPE_UIDS_KEY: InjectionKey<LayoutStyleScopeUidsSource> = Symbol('wwLayoutStyleScopeUids');

/**
 * Combines DOM style scopes while preserving their render-chain order.
 */
export function mergeLayoutStyleScopeUids(...scopeGroups: readonly (readonly LayoutStyleScopeUid[])[]) {
    const result: string[] = [];
    const seen = new Set<string>();

    for (const scopeGroup of scopeGroups) {
        for (const uid of scopeGroup) {
            if (!uid || seen.has(uid)) continue;

            seen.add(uid);
            result.push(uid);
        }
    }

    return result;
}

/**
 * Adds a renderless library component instance to the layout scopes inherited by its concrete root.
 */
export function provideLibraryComponentLayoutStyleScope(
    uid: MaybeRefOrGetter<string>,
    styleSourceId?: MaybeRefOrGetter<LayoutStyleSourceId>
) {
    const inheritedScopeUids = inject(LAYOUT_STYLE_SCOPE_UIDS_KEY, EMPTY_LAYOUT_STYLE_SCOPE_UIDS);
    const scopeUids = computed(() =>
        mergeLayoutStyleScopeUids(toValue(inheritedScopeUids), [
            encodeStyleSourceId(toValue(uid), toValue(styleSourceId)),
        ])
    );

    provide(LAYOUT_STYLE_SCOPE_UIDS_KEY, scopeUids);
}

/**
 * Returns every source scope allowed to style this layout.
 */
export function useLayoutStyleScopeAttribute(
    ownerUid: MaybeRefOrGetter<LayoutStyleScopeUid>,
    ownerStyleSourceId?: MaybeRefOrGetter<LayoutStyleSourceId>
): ComputedRef<string | undefined> {
    const inheritedScopeUids = inject(LAYOUT_STYLE_SCOPE_UIDS_KEY, EMPTY_LAYOUT_STYLE_SCOPE_UIDS);
    const scopeAttribute = computed(() => {
        const uid = toValue(ownerUid);
        const ownerScope = uid ? encodeStyleSourceId(uid, toValue(ownerStyleSourceId)) : undefined;
        const scopeUids = mergeLayoutStyleScopeUids([ownerScope], toValue(inheritedScopeUids));
        return scopeUids.length ? scopeUids.join(' ') : undefined;
    });

    return scopeAttribute;
}

/**
 * Starts a fresh layout scope chain when rendering a distinct element.
 *
 * Library component roots deliberately skip this reset because they are renderless aliases whose
 * root and instance scopes must reach the same concrete coded component.
 */
export function resetLibraryComponentLayoutStyleScopes() {
    provide(LAYOUT_STYLE_SCOPE_UIDS_KEY, EMPTY_LAYOUT_STYLE_SCOPE_UIDS);
}
