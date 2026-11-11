/**
 * Validates an author keyframes block and rewrites its global identifier to a compiler-owned name.
 */
export function rewriteAnimationKeyframes(value: unknown, name: string): string | null {
    if (typeof value !== 'string') return null;

    const trimmed = value.trim();
    if (!/^@keyframes/i.test(trimmed) || /<\/style/i.test(trimmed)) return null;

    return trimmed.replace(/^(@keyframes\s*)[^\s{]*(\s*\{)/i, `$1${name}$2`);
}
