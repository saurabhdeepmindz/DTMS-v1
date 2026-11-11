const STYLE_SOURCE_ID_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

export type StyleSourceIdRecord = {
    uid?: unknown;
    _si?: unknown;
};

export type StyleSourceIdRegistry = {
    idByUid: Map<string, number>;
    uidById: Map<number, string>;
    nextId: number;
};

export function createStyleSourceIdRegistry(): StyleSourceIdRegistry {
    return {
        idByUid: new Map(),
        uidById: new Map(),
        nextId: 0,
    };
}

export function isDenseStyleSourceId(value: unknown): value is number {
    return Number.isSafeInteger(value) && (value as number) >= 0;
}

/**
 * Reconciles persisted style ids while keeping already registered sources stable.
 *
 * Valid persisted ids are reserved before missing ids are allocated, so input ordering cannot steal
 * an id from a later persisted source. Duplicate/copy/import collisions are repaired on the copied
 * source and repeated records for the same uid reuse one identity.
 */
export function assignDenseStyleSourceIds(
    sources: Iterable<StyleSourceIdRecord>,
    registry: StyleSourceIdRegistry = createStyleSourceIdRegistry()
) {
    const pending: { source: StyleSourceIdRecord; uid: string }[] = [];

    for (const source of sources) {
        const uid = typeof source?.uid === 'string' ? source.uid : '';
        if (!uid) continue;

        const registeredId = registry.idByUid.get(uid);
        if (registeredId !== undefined) {
            source._si = registeredId;
            continue;
        }

        if (isDenseStyleSourceId(source._si) && !registry.uidById.has(source._si)) {
            registerStyleSourceId(registry, uid, source._si);
            continue;
        }

        pending.push({ source, uid });
    }

    for (const { source, uid } of pending) {
        const registeredId = registry.idByUid.get(uid);
        if (registeredId !== undefined) {
            source._si = registeredId;
            continue;
        }

        while (registry.uidById.has(registry.nextId)) registry.nextId++;
        source._si = registry.nextId;
        registerStyleSourceId(registry, uid, registry.nextId);
    }

    return registry;
}

export function encodeDenseStyleSourceId(id: number) {
    if (!isDenseStyleSourceId(id)) return undefined;

    let value = id;
    let token = '';
    do {
        token = STYLE_SOURCE_ID_ALPHABET[value % STYLE_SOURCE_ID_ALPHABET.length] + token;
        value = Math.floor(value / STYLE_SOURCE_ID_ALPHABET.length);
    } while (value > 0);

    // Vite can unquote attribute selector values. The alphabetic prefix keeps every token a valid
    // CSS identifier even when the base62 payload starts with a digit.
    return `d${token}`;
}

function registerStyleSourceId(registry: StyleSourceIdRegistry, uid: string, id: number) {
    registry.idByUid.set(uid, id);
    registry.uidById.set(id, uid);
    if (id >= registry.nextId) registry.nextId = id + 1;
}
