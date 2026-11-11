import type { Diagnostic, JobInput, Json } from './types.ts';

export const INPUT_LIMIT = 1024 * 1024;
export const RESULT_LIMIT = 1024 * 1024;
export const LOG_LIMIT = 100 * 1024;

/** Validate before stringify: JSON.stringify silently drops/coerces unsupported values. */
export function validateJson(value: unknown, seen = new Set<object>(), depth = 0): asserts value is Json {
    if (depth > 100) {
        throw new Error('Scheduled Task inputs are nested too deeply');
    }

    if (value === null || typeof value === 'string' || typeof value === 'boolean') {
        return;
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
        return;
    }

    if (typeof value !== 'object' || value === null) {
        throw new Error('Scheduled Task inputs must contain JSON values only');
    }

    if (seen.has(value)) {
        throw new Error('Scheduled Task inputs cannot contain circular references');
    }

    if (
        !Array.isArray(value) &&
        Object.getPrototypeOf(value) !== Object.prototype &&
        Object.getPrototypeOf(value) !== null
    ) {
        throw new Error('Use ISO strings for dates and references for files in Scheduled Task inputs');
    }

    seen.add(value);
    try {
        if (Object.getOwnPropertySymbols(value).length) {
            throw new Error('Scheduled Task inputs cannot contain symbol keys');
        }

        if (Array.isArray(value)) {
            for (let index = 0; index < value.length; index++) {
                if (!Object.hasOwn(value, index)) {
                    throw new Error('Scheduled Task inputs cannot contain sparse arrays');
                }

                const descriptor = Object.getOwnPropertyDescriptor(value, index);
                if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
                    throw new Error('Scheduled Task inputs cannot contain getters');
                }

                validateJson(descriptor.value, seen, depth + 1);
            }
        } else {
            for (const key of Object.keys(value)) {
                const descriptor = Object.getOwnPropertyDescriptor(value, key);
                if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
                    throw new Error('Scheduled Task inputs cannot contain getters');
                }

                validateJson(descriptor.value, seen, depth + 1);
            }
        }
    } finally {
        seen.delete(value);
    }
}

export function validateDate(value: string): string {
    if (
        typeof value !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(value) ||
        !Number.isFinite(Date.parse(value))
    ) {
        throw new Error('Use an ISO date with a timezone');
    }

    return new Date(value).toISOString();
}

function integerOption(value: unknown, name: string, min: number, max: number) {
    if (value !== undefined && (!Number.isInteger(value) || (value as number) < min || (value as number) > max)) {
        throw new Error(`${name} must be an integer between ${min} and ${max}`);
    }
}

export function validateJob(input: JobInput, options: { hosted?: boolean } = {}): JobInput {
    if (!input || typeof input.workflowId !== 'string' || !input.workflowId || input.workflowId.length > 255) {
        throw new Error('A Scheduled Task workflow is required');
    }

    const parameters = input.inputs ?? {};
    if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) {
        throw new Error('Scheduled Task inputs must be an object');
    }

    validateJson(parameters);
    const json = JSON.stringify(parameters);
    if (Buffer.byteLength(json, 'utf8') > INPUT_LIMIT) {
        throw new Error('Scheduled Task inputs exceed 1 MiB; use references for large data');
    }

    integerOption(input.maxAttempts, 'Maximum attempts', 1, 1000);
    integerOption(input.timeoutMs, 'Attempt timeout', 1000, options.hosted ? 840000 : 86400000);
    integerOption(input.retryDelayMs, 'Retry delay', 1000, 3600000);
    integerOption(input.priority, 'Priority', -32768, 32767);
    for (const name of ['name', 'queue', 'key'] as const) {
        if (input[name] !== undefined && (typeof input[name] !== 'string' || input[name].length > 255)) {
            throw new Error(`Invalid Scheduled Task ${name}`);
        }
    }

    if (input.keyMode !== undefined && !['replace', 'preserve_run_at'].includes(input.keyMode)) {
        throw new Error('Invalid Scheduled Task key mode');
    }

    return {
        ...input,
        inputs: JSON.parse(json),
        ...(input.runAt !== undefined && { runAt: validateDate(input.runAt) }),
    };
}

function truncateUtf8(text: string, bytes: number): string {
    const buffer = Buffer.from(text);
    let end = Math.min(bytes, buffer.length);
    if (end < buffer.length) {
        while (end > 0 && (buffer[end] & 0xc0) === 0x80) {
            end--;
        }
    }

    return buffer.subarray(0, end).toString('utf8');
}

export function diagnostic(value: unknown, limit = RESULT_LIMIT): Diagnostic {
    if (value === undefined) {
        return { unavailable: true, truncated: false };
    }

    try {
        const seen = new WeakSet<object>();
        const text = JSON.stringify(value, (_key, item) => {
            if (typeof item === 'bigint') {
                return item.toString();
            }

            if (typeof item === 'function' || typeof item === 'symbol') {
                return '[Unsupported diagnostic value]';
            }

            if (item && typeof item === 'object') {
                if (item instanceof Map || item instanceof Set) {
                    throw new Error('Unsupported diagnostic container');
                }

                if (seen.has(item)) {
                    return '[Circular or repeated reference]';
                }

                seen.add(item);
                if (item instanceof Error) {
                    return { name: item.name, message: item.message };
                }
            }

            return item;
        });
        if (text === undefined) {
            return { unavailable: true, truncated: false };
        }

        if (Buffer.byteLength(text) <= limit) {
            return { value: JSON.parse(text), truncated: false };
        }

        return { preview: truncateUtf8(text, limit), truncated: true };
    } catch {
        return { unavailable: true, truncated: false };
    }
}

export function retryDate(attempts: number, initialMs = 10000, now = Date.now(), random = Math.random): string {
    const delay = Math.min(3600000, initialMs * 2 ** Math.min(Math.max(attempts - 1, 0), 20));

    return new Date(now + Math.round(Math.min(3600000, delay * (0.8 + random() * 0.4)))).toISOString();
}

const parameterTypes: Record<string, { label: string; accepts: (value: unknown) => boolean }> = {
    number: {
        label: 'a number',
        accepts: value =>
            (typeof value === 'number' && Number.isFinite(value)) ||
            (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))),
    },
    boolean: { label: 'a boolean', accepts: value => typeof value === 'boolean' },
    array: { label: 'a list', accepts: value => Array.isArray(value) },
    object: { label: 'an object', accepts: value => typeof value === 'object' && !Array.isArray(value) },
};

/** Scheduled Task inputs are checked when submitted, so a wrong value cannot fail every retry later. */
export function parameterError(
    parameter: { name: string; type?: string; required?: boolean },
    inputs: Record<string, unknown> | undefined
) {
    const value = inputs?.[parameter.type === 'table-link' ? `table:${parameter.name}` : parameter.name];
    if (value == null) {
        return parameter.required ? `Missing required Scheduled Task parameter: ${parameter.name}` : null;
    }

    const type = parameterTypes[parameter.type ?? ''];
    if (type && !type.accepts(value)) {
        return `Scheduled Task parameter ${parameter.name} must be ${type.label}`;
    }

    return null;
}

/** Normalize only values accepted by parameterError. */
export function normalizeJobParameters(inputs: Record<string, unknown>, parameters: { name: string; type?: string }[]) {
    const normalized = { ...inputs };
    for (const parameter of parameters) {
        const value = normalized[parameter.name];
        if (
            parameter.type === 'number' &&
            typeof value === 'string' &&
            value.trim() !== '' &&
            Number.isFinite(Number(value))
        ) {
            normalized[parameter.name] = Number(value);
        }
    }
    return normalized;
}
