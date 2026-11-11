/**
 * Current fixed WeWeb breakpoint order.
 */
export const STYLE_BREAKPOINTS = [
    { name: 'default', mediaQuery: null },
    { name: 'tablet', mediaQuery: 'max-width: 991px' },
    { name: 'mobile', mediaQuery: 'max-width: 767px' },
] as const;

export type StyleBreakpointName = (typeof STYLE_BREAKPOINTS)[number]['name'];
export type StyleBreakpointDefinition = (typeof STYLE_BREAKPOINTS)[number];

const STYLE_BREAKPOINT_RANGE_MEDIA_QUERIES: Record<StyleBreakpointName, string> = {
    default: '(min-width: 992px)',
    tablet: '(min-width: 768px) and (max-width: 991px)',
    mobile: '(max-width: 767px)',
};

/**
 * Returns a mutually exclusive media query for declarations that cannot rely on cascade resets.
 */
export function getStyleBreakpointRangeMediaQuery(breakpoint: StyleBreakpointName) {
    return STYLE_BREAKPOINT_RANGE_MEDIA_QUERIES[breakpoint];
}
