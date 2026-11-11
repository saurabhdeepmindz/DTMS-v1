export function joinUrlPath(...segments: (string | number)[]): string {
    const filtered = segments.filter(s => s !== '');
    if (filtered.length === 0) return '';

    const first = String(filtered[0]);
    const leading = first.startsWith('/') ? '/' : '';

    const joined = filtered
        .map(s => String(s).replace(/^\/+|\/+$/g, ''))
        .filter(Boolean)
        .join('/');

    return leading + joined;
}
