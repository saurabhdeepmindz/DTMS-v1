export const AUTHORED_LENGTH_KEYWORDS = [
    'auto',
    'normal',
    'unset',
    'fit-content',
    'min-content',
    'max-content',
] as const;

export type AuthoredLengthKeyword = (typeof AUTHORED_LENGTH_KEYWORDS)[number];
export type AuthoredLengthUnit = 'px' | '%' | 'em' | 'rem' | 'vw' | 'vh';

export interface AuthoredLengthContext {
    percentBase: number;
    fontSize: number;
    rootFontSize: number;
    viewportWidth: number;
    viewportHeight: number;
}

export interface ParsedAuthoredLength {
    kind: 'fixed' | 'content' | 'dynamic' | 'unset';
    value?: number;
    unit?: AuthoredLengthUnit;
    label?: string;
}

export interface SplitAuthoredLengthOptions {
    defaultLength?: number;
    defaultUnit?: string;
    round?: boolean;
}

const FIXED_LENGTH_RE = /^(-?(?:\d+\.?\d*|\.\d+))(px|%|em|rem|vw|vh)$/i;
const LEGACY_LENGTH_RE = /^(-?[\d.]+)(.*)$/;
const AUTHORED_LENGTH_KEYWORD_SET = new Set<string>(AUTHORED_LENGTH_KEYWORDS);

export function isAuthoredLengthKeyword(value: unknown): value is AuthoredLengthKeyword {
    return typeof value === 'string' && AUTHORED_LENGTH_KEYWORD_SET.has(value);
}

export function parseAuthoredLength(value: unknown): ParsedAuthoredLength {
    if (value && typeof value === 'object' && Object.hasOwn(value, '__wwtype')) return { kind: 'dynamic' };
    if (typeof value !== 'string') return { kind: 'unset' };

    const normalized = value.trim().toLowerCase();
    if (normalized.startsWith('var(')) return { kind: 'dynamic' };
    if (isAuthoredLengthKeyword(normalized)) {
        return { kind: 'content', label: normalized === 'fit-content' ? 'Fit' : 'Auto' };
    }

    const match = normalized.match(FIXED_LENGTH_RE);
    if (!match) return { kind: 'unset' };
    return { kind: 'fixed', value: Number(match[1]), unit: match[2] as AuthoredLengthUnit };
}

export function authoredLengthToPixels(
    value: number,
    unit: AuthoredLengthUnit,
    context: AuthoredLengthContext
): number {
    switch (unit) {
        case '%':
            return (value / 100) * context.percentBase;
        case 'em':
            return value * context.fontSize;
        case 'rem':
            return value * context.rootFontSize;
        case 'vw':
            return (value / 100) * context.viewportWidth;
        case 'vh':
            return (value / 100) * context.viewportHeight;
        default:
            return value;
    }
}

export function pixelsToAuthoredLength(
    value: number,
    unit: AuthoredLengthUnit,
    context: AuthoredLengthContext
): number {
    switch (unit) {
        case '%':
            return context.percentBase ? (value / context.percentBase) * 100 : 0;
        case 'em':
            return context.fontSize ? value / context.fontSize : 0;
        case 'rem':
            return context.rootFontSize ? value / context.rootFontSize : 0;
        case 'vw':
            return context.viewportWidth ? (value / context.viewportWidth) * 100 : 0;
        case 'vh':
            return context.viewportHeight ? (value / context.viewportHeight) * 100 : 0;
        default:
            return value;
    }
}

export function formatAuthoredLength(value: number, unit: AuthoredLengthUnit): string {
    const digits = unit === 'px' ? 0 : unit === 'em' || unit === 'rem' ? 3 : 2;
    const rounded = Number(Math.max(0, value).toFixed(digits));
    return `${rounded}${unit}`;
}

const DIRECT_MANIPULATION_STEPS: Readonly<Record<AuthoredLengthUnit, number>> = Object.freeze({
    px: 1,
    '%': 1,
    em: 0.125,
    rem: 0.125,
    vw: 0.1,
    vh: 0.1,
});

export function quantizeAuthoredLength(
    value: number,
    unit: AuthoredLengthUnit,
    bounds: { minimum: number; maximum: number; tolerance?: number } = { minimum: -Infinity, maximum: Infinity }
): number {
    const step = DIRECT_MANIPULATION_STEPS[unit];
    const tolerance = Math.max(0, bounds.tolerance ?? 1e-9);
    const minimum = Math.ceil((bounds.minimum - tolerance) / step) * step;
    const maximum = Math.floor((bounds.maximum + tolerance) / step) * step;
    if (minimum > maximum) return Math.min(bounds.maximum, Math.max(bounds.minimum, value));
    return Math.min(maximum, Math.max(minimum, Math.round(value / step) * step));
}

/**
 * Compatibility parser for the public wwUtils.getLengthUnit interface.
 * It intentionally preserves that interface's permissive parsing and return types.
 */
export function splitAuthoredLength(
    value: unknown,
    { defaultLength, defaultUnit, round = true }: SplitAuthoredLengthOptions = {}
): [number | string, string] {
    if (typeof value !== 'string') return [0, 'auto'];
    if (isAuthoredLengthKeyword(value)) return [0, value];

    const match = value.match(LEGACY_LENGTH_RE);
    const length = match?.[1] || defaultLength || 0;
    const unit = match?.[2] || defaultUnit || 'auto';
    return [round ? Math.round(Number(length)) : length, unit];
}
