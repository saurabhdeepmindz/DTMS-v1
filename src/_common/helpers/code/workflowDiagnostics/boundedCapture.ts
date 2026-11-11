// Bounded snapshot of arbitrary runtime values for remote workflow diagnostics (WW-6080).
// Work is bounded by a node budget, depth, per-container item counts and the exact UTF-8 size of the JSON output.

export const CAPTURE_LIMITS = Object.freeze({
    maxNodes: 4000,
    maxDepth: 8,
    maxTruncations: 16,
    maxPathLength: 160,
    maxKeyBytes: 128,
    maxErrors: 8,
    maxStringBytes: 1024,
    maxArrayItems: 50,
    maxObjectKeys: 100,
});

export const TRUNCATED_PLACEHOLDER = '[TRUNCATED]';
const STRING_SUFFIX = `...${TRUNCATED_PLACEHOLDER}`;
const PLACEHOLDER_BYTES = TRUNCATED_PLACEHOLDER.length + 2;
// Keys past a container's limit are still counted up to this many, so the report says how much was dropped.
const MAX_DROPPED_COUNT = 100;
const UNREADABLE = Symbol('unreadable');

export type NodeBudget = { remaining: number };

export type Truncation = { path: string; type: string; [detail: string]: unknown };

export type CaptureOptions = {
    maxBytes: number;
    budget: NodeBudget;
    maxDepth?: number;
    maxStringBytes?: number;
    maxKeyBytes?: number;
    maxArrayItems?: number;
    maxObjectKeys?: number;
    maxTruncations?: number;
    maxPathLength?: number;
    skipKeys?: ReadonlySet<string>;
    detectFileLike?: boolean;
};

export type CaptureResult = {
    value: unknown;
    bytes: number;
    nodes: number;
    truncationCount: number;
    truncations: Truncation[];
    reasons: Record<string, number>;
};

type PathFrame = { parent: PathFrame | null; key: string | number } | null;

type State = Required<Omit<CaptureOptions, 'budget' | 'skipKeys'>> & {
    budget: NodeBudget;
    skipKeys: ReadonlySet<string> | null;
    seen: WeakSet<object>;
    nodes: number;
    truncationCount: number;
    truncations: Truncation[];
    reasons: Record<string, number>;
};

type Captured = { value: unknown; bytes: number };

/** @param {number} [maxNodes] */
export function createNodeBudget(maxNodes: number = CAPTURE_LIMITS.maxNodes): NodeBudget {
    return { remaining: maxNodes };
}

export function utf8ByteLength(value: string): number {
    let bytes = 0;
    for (let i = 0; i < value.length; i += 1) {
        const code = value.charCodeAt(i);
        if (code < 0x80) bytes += 1;
        else if (code < 0x800) bytes += 2;
        else if (isHighSurrogate(code) && isLowSurrogate(value.charCodeAt(i + 1))) {
            bytes += 4;
            i += 1;
        } else bytes += 3;
    }
    return bytes;
}

function isHighSurrogate(code: number) {
    return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number) {
    return code >= 0xdc00 && code <= 0xdfff;
}

// UTF-8 size of one character once JSON.stringify has escaped it; `units` is how many UTF-16 units it consumes.
function jsonCharBytes(value: string, index: number): { bytes: number; units: number } {
    const code = value.charCodeAt(index);
    if (code === 0x22 || code === 0x5c) return { bytes: 2, units: 1 };
    if (code === 0) return { bytes: 3, units: 1 };
    if (code < 0x20) return { bytes: [0x08, 0x09, 0x0a, 0x0c, 0x0d].includes(code) ? 2 : 6, units: 1 };
    if (code < 0x80) return { bytes: 1, units: 1 };
    if (code < 0x800) return { bytes: 2, units: 1 };
    if (isHighSurrogate(code)) {
        return isLowSurrogate(value.charCodeAt(index + 1)) ? { bytes: 4, units: 2 } : { bytes: 3, units: 1 };
    }
    if (isLowSurrogate(code)) return { bytes: 3, units: 1 };
    return { bytes: 3, units: 1 };
}

export function normalizeDiagnosticText(value: string): string {
    return value.replace(/\u0000/g, '\u2400').replace(/[\ud800-\udfff]/g, (character: string, index: number, text: string) => {
        const code = character.charCodeAt(0);
        if (isHighSurrogate(code) && isLowSurrogate(text.charCodeAt(index + 1))) return character;
        if (isLowSurrogate(code) && isHighSurrogate(text.charCodeAt(index - 1))) return character;
        return '\ufffd';
    });
}

// Longest prefix whose JSON literal (quotes included) fits maxBytes; inspects at most maxBytes characters.
function fitJsonString(
    value: string,
    maxBytes: number,
    suffix = STRING_SUFFIX
): { text: string; bytes: number; cut: boolean } {
    let bytes = 2;
    let index = 0;
    while (index < value.length) {
        const char = jsonCharBytes(value, index);
        if (bytes + char.bytes > maxBytes) break;
        bytes += char.bytes;
        index += char.units;
    }
    if (index >= value.length) return { text: normalizeDiagnosticText(value), bytes, cut: false };

    const suffixBytes = suffix.length;
    while (index > 0 && bytes + suffixBytes > maxBytes) {
        const previous =
            isLowSurrogate(value.charCodeAt(index - 1)) && isHighSurrogate(value.charCodeAt(index - 2)) ? 2 : 1;
        index -= previous;
        bytes -= jsonCharBytes(value, index).bytes;
    }
    if (bytes + suffixBytes > maxBytes) return { text: '', bytes: 2, cut: true };
    return { text: normalizeDiagnosticText(value.slice(0, index)) + suffix, bytes: bytes + suffixBytes, cut: true };
}

function renderPath(frame: PathFrame, maxLength: number): string {
    if (!frame) return '$';
    const segments: (string | number)[] = [];
    for (let cursor: PathFrame = frame; cursor; cursor = cursor.parent) segments.push(cursor.key);
    let path = '';
    for (let i = segments.length - 1; i >= 0; i -= 1) {
        const key = segments[i];
        path = typeof key === 'number' ? `${path || '$'}[${key}]` : path ? `${path}.${key}` : key;
        if (path.length > maxLength) return `${normalizeDiagnosticText(path.slice(0, maxLength - 3))}...`;
    }
    return path;
}

function record(state: State, frame: PathFrame, type: string, details: Record<string, unknown> = {}) {
    state.truncationCount += 1;
    state.reasons[type] = (state.reasons[type] || 0) + 1;
    if (state.truncations.length < state.maxTruncations) {
        state.truncations.push({ path: renderPath(frame, state.maxPathLength), type, ...details });
    }
}

function placeholder(state: State, frame: PathFrame, type: string, details?: Record<string, unknown>): Captured {
    record(state, frame, type, details);
    return { value: TRUNCATED_PLACEHOLDER, bytes: PLACEHOLDER_BYTES };
}

function captureString(state: State, frame: PathFrame, value: string, room: number): Captured {
    const fitted = fitJsonString(value, Math.min(room, state.maxStringBytes));
    if (fitted.cut) record(state, frame, 'string', { originalLength: value.length });
    return { value: fitted.text, bytes: fitted.bytes };
}

function captureKey(state: State, key: string): { text: string; bytes: number } {
    return fitJsonString(key, state.maxKeyBytes, '...');
}

function getBinarySize(value: object): number | null {
    if (value instanceof ArrayBuffer) return value.byteLength;
    if (ArrayBuffer.isView(value)) return value.byteLength;
    if (typeof Blob !== 'undefined' && value instanceof Blob) return value.size;
    return null;
}

// Socket debug uploads expose file metadata, never their contents.
function fileLikeFields(value: Record<string, unknown>) {
    if (typeof value.name !== 'string' || typeof value.size !== 'number') return null;
    const fields: Record<string, unknown> & { name: string; size: number } = { name: value.name, size: value.size };
    if (typeof value.type === 'string') fields.type = value.type;
    if (typeof value.mime === 'string') fields.type = value.mime;
    if (value.lastModified) fields.lastModified = value.lastModified;
    if (value.lastModifiedDate) fields.lastModifiedDate = value.lastModifiedDate;
    if ('data' in value || 'content' in value || 'buffer' in value || 'bytes' in value) fields.data = TRUNCATED_PLACEHOLDER;
    return fields;
}

function errorFields(value: Error): Record<string, unknown> {
    const fields: Record<string, unknown> = { name: value.name, message: value.message };
    const details = value as Error & Record<string, unknown>;
    for (const key of ['code', 'status', 'statusCode', 'stack']) {
        if (details[key] !== undefined) fields[key] = details[key];
    }
    return fields;
}

function visitArray(state: State, frame: PathFrame, value: ArrayLike<unknown>, depth: number, room: number): Captured {
    const length = value.length;
    const out: unknown[] = [];
    let bytes = 2;
    const limit = Math.min(length, state.maxArrayItems);
    let index = 0;
    for (; index < limit; index += 1) {
        const separator = index ? 1 : 0;
        if (state.budget.remaining <= 0) {
            record(state, frame, 'maxNodes', { kept: index, dropped: length - index });
            return { value: out, bytes };
        }
        if (bytes + separator + PLACEHOLDER_BYTES > room) {
            record(state, frame, 'maxTotalBytes', { kept: index, dropped: length - index });
            return { value: out, bytes };
        }
        const child = visit(
            state,
            { parent: frame, key: index },
            readIndex(value, index),
            depth + 1,
            room - bytes - separator,
            true
        );
        out.push(child.value);
        bytes += separator + child.bytes;
    }
    if (length > index) record(state, frame, 'array', { kept: index, dropped: length - index });
    return { value: out, bytes };
}

function readIndex(value: ArrayLike<unknown>, index: number): unknown {
    return readSafely(() => value[index]);
}

// Entries carry a reader so keys past the limits are counted without invoking their getters.
type Entry = [key: string, read: () => unknown];

function visitEntries(state: State, frame: PathFrame, entries: Iterable<Entry>, depth: number, room: number): Captured {
    const out: Record<string, unknown> = Object.create(null);
    let bytes = 2;
    let kept = 0;
    let dropped = 0;
    let stopReason: string | null = null;
    for (const [key, read] of entries) {
        if (stopReason) {
            dropped += 1;
            if (dropped >= MAX_DROPPED_COUNT) break;
            continue;
        }
        if (state.budget.remaining <= 0) stopReason = 'maxNodes';
        else if (kept >= state.maxObjectKeys) stopReason = 'object';
        if (stopReason) {
            dropped += 1;
            continue;
        }
        const child = readSafely(read);
        if (child === undefined) {
            // JSON omits it, but reading it was still work (possibly a getter).
            state.budget.remaining -= 1;
            state.nodes += 1;
            continue;
        }
        let capturedKey = captureKey(state, key);
        if (capturedKey.text !== key) record(state, frame, 'key', { originalLength: key.length });
        if (Object.hasOwn(out, capturedKey.text)) capturedKey = captureKey(state, `${capturedKey.text}~${kept}`);
        const separator = kept ? 1 : 0;
        const entryOverhead = separator + capturedKey.bytes + 1;
        if (bytes + entryOverhead + PLACEHOLDER_BYTES > room) {
            stopReason = 'maxTotalBytes';
            dropped += 1;
            continue;
        }
        const captured = visit(
            state,
            { parent: frame, key: capturedKey.text },
            child,
            depth + 1,
            room - bytes - entryOverhead,
            false
        );
        out[capturedKey.text] = captured.value;
        bytes += entryOverhead + captured.bytes;
        kept += 1;
    }
    if (stopReason) {
        const details: Record<string, unknown> = { kept, dropped };
        if (dropped >= MAX_DROPPED_COUNT) details.droppedAtLeast = true;
        record(state, frame, stopReason, details);
    }
    return { value: out, bytes };
}

function readSafely(read: () => unknown): unknown {
    try {
        return read();
    } catch {
        return UNREADABLE;
    }
}

// V8 enumerates keys up front. The capture-wide seen set prevents repeating that cost;
// every loop iteration (including inherited/filtered keys) also consumes the work budget.
function* ownEntries(state: State, frame: PathFrame, value: object): Generator<Entry> {
    for (const key in value) {
        if (state.budget.remaining <= 0) {
            record(state, frame, 'maxNodes', { droppedAtLeast: true });
            return;
        }
        if (!Object.hasOwn(value, key) || state.skipKeys?.has(key)) {
            state.budget.remaining -= 1;
            state.nodes += 1;
            continue;
        }
        const before = state.budget.remaining;
        yield [key, () => (value as Record<string, unknown>)[key]];
        // visit (or the undefined path) already charges yielded values. Count skipped tail keys too.
        if (state.budget.remaining === before) {
            state.budget.remaining -= 1;
            state.nodes += 1;
        }
    }
}

function* mapEntries(value: Map<unknown, unknown>): Generator<Entry> {
    for (const [key, child] of value) yield [typeof key === 'string' ? key : String(key), () => child];
}

function* fieldEntries(fields: Record<string, unknown>): Generator<Entry> {
    for (const key in fields) yield [key, () => fields[key]];
}

function visitObject(state: State, frame: PathFrame, value: object, depth: number, room: number): Captured {
    if (Array.isArray(value)) return visitArray(state, frame, value, depth, room);
    if (value instanceof Date) {
        const time = value.getTime();
        return Number.isFinite(time)
            ? captureString(state, frame, value.toISOString(), room)
            : { value: null, bytes: 4 };
    }
    const binarySize = getBinarySize(value);
    if (binarySize !== null) return placeholder(state, frame, 'binary', { size: binarySize });
    if (value instanceof Error) return visitEntries(state, frame, fieldEntries(errorFields(value)), depth, room);
    if (value instanceof Map) return visitEntries(state, frame, mapEntries(value), depth, room);
    const file = state.detectFileLike ? fileLikeFields(value as Record<string, unknown>) : null;
    if (file) {
        record(state, frame, 'file', { name: file.name.slice(0, 100), size: file.size, mime: typeof file.type === 'string' ? file.type.slice(0, 255) : undefined });
        return visitEntries(state, frame, fieldEntries(file), depth, room);
    }
    if (value instanceof Set) return visitArray(state, frame, lazyArray(value, state.maxArrayItems), depth, room);
    return visitEntries(state, frame, ownEntries(state, frame, value), depth, room);
}

// Copies at most `limit` set values, keeping the real size for the dropped count.
function lazyArray(value: Set<unknown>, limit: number): ArrayLike<unknown> {
    const items: unknown[] = [];
    for (const item of value) {
        if (items.length >= limit) break;
        items.push(item);
    }
    return { ...items, length: value.size };
}

function visit(
    state: State,
    frame: PathFrame,
    value: unknown,
    depth: number,
    room: number,
    inArray: boolean
): Captured {
    if (state.budget.remaining <= 0) return placeholder(state, frame, 'maxNodes');
    state.budget.remaining -= 1;
    state.nodes += 1;

    if (value === UNREADABLE) return placeholder(state, frame, 'unreadable');
    if (value === null || value === undefined) return { value: null, bytes: 4 };
    switch (typeof value) {
        case 'string':
            return captureString(state, frame, value, room);
        case 'boolean':
            return { value, bytes: value ? 4 : 5 };
        case 'number': {
            if (!Number.isFinite(value)) return { value: null, bytes: 4 };
            const text = JSON.stringify(value);
            return text.length > room ? placeholder(state, frame, 'maxTotalBytes') : { value, bytes: text.length };
        }
        case 'bigint':
            return captureString(state, frame, value.toString(), room);
        case 'function':
        case 'symbol':
            // JSON drops these in objects and nulls them in arrays; a placeholder keeps their presence visible.
            return inArray ? { value: null, bytes: 4 } : placeholder(state, frame, 'unsupported');
    }

    const object = value as object;
    try {
        if (depth >= state.maxDepth) return placeholder(state, frame, 'maxDepth', { maxDepth: state.maxDepth });
        if (state.seen.has(object)) return placeholder(state, frame, 'circular');
        state.seen.add(object);
        return visitObject(state, frame, object, depth, room);
    } catch {
        return placeholder(state, frame, 'unreadable');
    }
}

export function captureBounded(value: unknown, options: CaptureOptions): CaptureResult {
    const state: State = {
        maxBytes: options.maxBytes,
        budget: options.budget,
        maxDepth: options.maxDepth ?? CAPTURE_LIMITS.maxDepth,
        maxStringBytes: options.maxStringBytes ?? CAPTURE_LIMITS.maxStringBytes,
        maxKeyBytes: options.maxKeyBytes ?? CAPTURE_LIMITS.maxKeyBytes,
        maxArrayItems: options.maxArrayItems ?? CAPTURE_LIMITS.maxArrayItems,
        maxObjectKeys: options.maxObjectKeys ?? CAPTURE_LIMITS.maxObjectKeys,
        maxTruncations: options.maxTruncations ?? CAPTURE_LIMITS.maxTruncations,
        maxPathLength: options.maxPathLength ?? CAPTURE_LIMITS.maxPathLength,
        skipKeys: options.skipKeys ?? null,
        detectFileLike: options.detectFileLike ?? false,
        seen: new WeakSet(),
        nodes: 0,
        truncationCount: 0,
        truncations: [],
        reasons: {},
    };
    const captured =
        options.maxBytes < PLACEHOLDER_BYTES
            ? { value: null, bytes: 4 }
            : visit(state, null, value, 0, options.maxBytes, false);
    return {
        value: captured.value,
        bytes: captured.bytes,
        nodes: state.nodes,
        truncationCount: state.truncationCount,
        truncations: state.truncations,
        reasons: state.reasons,
    };
}
