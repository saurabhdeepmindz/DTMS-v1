export type UnknownRecord = Record<string, unknown>;

export function isPlainObject<T extends UnknownRecord = UnknownRecord>(value: unknown): value is T {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
