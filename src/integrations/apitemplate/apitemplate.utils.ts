export function getHeaders(apiKey: string) {
    return {
        'X-API-KEY': apiKey,
        'Content-Type': 'application/json',
    };
}

export function buildQueryString(params: Record<string, any>): string {
    if (!params || Object.keys(params).length === 0) {
        return '';
    }

    const queryParts = Object.entries(params)
        .filter(([_key, value]) => value !== undefined && value !== null && value !== '')
        .map(([key, value]) => {
            if (typeof value === 'boolean') {
                return `${key}=${value ? '1' : '0'}`;
            }
            return `${key}=${encodeURIComponent(value)}`;
        })
        .join('&');

    return queryParts ? `?${queryParts}` : '';
}
