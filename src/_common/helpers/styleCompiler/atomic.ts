import type { StyleDeclarationPriority, StyleRuleGroup } from './types';

const ATOMIC_CLASS_PREFIX = 'ww-a-';
const BASE64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/**
 * Creates a stable, cross-runtime class for one compiler-owned default declaration bundle.
 *
 * The group is part of the identity so a class emitted in one cascade layer cannot accidentally
 * activate a declaration emitted for another layer. Three independent 32-bit hashes keep the DOM
 * token bounded while making accidental cross-page collisions negligible.
 */
export function createAtomicStyleClassName({
    group,
    declarations,
}: {
    group: StyleRuleGroup;
    declarations: readonly {
        property: string;
        value: string;
        priority: StyleDeclarationPriority;
    }[];
}) {
    const key = `${group}\u001d${declarations
        .map(({ property, value, priority }) => `${property}\u001f${value}\u001f${priority}`)
        .join('\u001e')}`;
    const bytes = new Uint8Array(12);
    writeUint32(bytes, 0, hashString(key, 0x811c9dc5));
    writeUint32(bytes, 4, hashString(key, 0x9e3779b9));
    writeUint32(bytes, 8, hashString(key, 0x85ebca6b));
    return `${ATOMIC_CLASS_PREFIX}${encodeBase64Url(bytes)}`;
}

function hashString(value: string, seed: number) {
    let hash = seed >>> 0;
    for (let index = 0; index < value.length; index++) {
        const code = value.charCodeAt(index);
        hash ^= code & 0xff;
        hash = Math.imul(hash, 0x01000193);
        hash ^= code >>> 8;
        hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
}

function writeUint32(target: Uint8Array, offset: number, value: number) {
    target[offset] = value >>> 24;
    target[offset + 1] = value >>> 16;
    target[offset + 2] = value >>> 8;
    target[offset + 3] = value;
}

function encodeBase64Url(bytes: Uint8Array) {
    let result = '';
    for (let index = 0; index < bytes.length; index += 3) {
        const value = (bytes[index] << 16) | (bytes[index + 1] << 8) | bytes[index + 2];
        result += BASE64URL_ALPHABET[(value >>> 18) & 63];
        result += BASE64URL_ALPHABET[(value >>> 12) & 63];
        result += BASE64URL_ALPHABET[(value >>> 6) & 63];
        result += BASE64URL_ALPHABET[value & 63];
    }
    return result;
}
