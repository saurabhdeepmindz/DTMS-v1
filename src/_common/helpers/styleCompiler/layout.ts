/**
 * Pure layout helpers shared between the style compiler (CSS generation) and the editor runtime
 * (e.g. wwLayout drag direction), so the flex-direction logic lives in a single place.
 */

/**
 * Resolve the final flex-direction from the raw `_ww-layout_flexDirection` + `_ww-layout_reverse`
 * content values. Returns the reverse-applied direction (or the direction unchanged / undefined).
 */
export function getFlexDirection(direction: unknown, reversed: unknown) {
    if (direction === 'column' && reversed) return 'column-reverse';
    if (direction === 'row' && reversed) return 'row-reverse';
    return direction;
}
