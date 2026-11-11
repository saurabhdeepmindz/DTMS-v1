export function serializeTableViewQueryParameters(parameters: Record<string, unknown> = {}) {
    const serialized: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(parameters)) {
        serialized[key] = value !== null && typeof value === 'object' ? JSON.stringify(value) : value;
    }

    return serialized;
}
