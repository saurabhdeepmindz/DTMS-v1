/** Keep the first match and the original reactive objects, including colliding aliases. */
export function indexByFirst<T>(items: T[], keys: (item: T) => Array<string | undefined>): Record<string, T> {
    const index: Record<string, T> = Object.create(null);
    for (const item of items) {
        for (const key of keys(item)) {
            if (key === undefined || Object.hasOwn(index, key)) continue;
            index[key] = item;
        }
    }
    return index;
}
