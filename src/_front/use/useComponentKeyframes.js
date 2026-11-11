import { computed } from 'vue';

/**
 * Editor-only animation preview override.
 *
 * The published animation (the `animation-*` longhands and the `@keyframes` block) is rendered by the
 * style compiler on the element's compact style rule. Two editor-canvas behaviors cannot live in the pure
 * compiler and are driven here with an inline override (inline styles win over the compiler layer):
 *  - non-selected elements stay static (`animation: none`);
 *  - the selected element previews the keyframe editor (`keyframe-edition-animation`, played/paused
 *    from `editorKeyframesStore`).
 *
 * The keyframe preview rebuilds the FULL animation shorthand from the element's data plus the historic
 * defaults. The compiler preserves the same `iteration-count → infinite` default for the published
 * animation, while this override additionally controls play/pause during keyframe editing.
 *
 * The whole override is stripped from the published build, which then animates purely from CSS.
 */
export function useComponentKeyframes( ) {
    /* wwFront:start */
    return {};
    /* wwFront:end */
 }

 