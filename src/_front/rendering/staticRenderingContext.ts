import { ref } from 'vue';
import { isStaticRenderMode, renderMode } from './renderMode';

type StaticBindingResolution = { value: unknown } | undefined;

export class StaticRenderFatalError extends Error {
    constructor(message: string, options?: ErrorOptions) {
        super(message, options);
        this.name = 'StaticRenderFatalError';
    }
}

let active = isStaticRenderMode(renderMode) ? ref(true) : null;
let staticProjectionBypassDepth = 0;

export function activateStaticRendering(): void {
    if (active) return;
    active = ref(true);
}

export function deactivateStaticRendering(): void {
    if (!active) return;

    const previousActive = active;
    // Re-evaluated bindings must stop tracking the static context.
    active = null;
    previousActive.value = false;
}

export function isStaticRenderingActive(): boolean {
    return active?.value === true;
}

export function isStaticRenderPermissionError(error: unknown): boolean {
    if (!isStaticRenderingActive() || !(error instanceof Error)) return false;
    return error.name === 'NotCapable' || error.name === 'PermissionDenied';
}

/**
 * Evaluates one synchronous binding against its live context without consuming a persisted static
 * projection. Runtime CSS prerendering uses this to resolve each reusable component instance while
 * the rest of the server-rendered Vue tree keeps its deterministic static projection.
 */
export function withoutStaticBindingProjection<T>(callback: () => T): T {
    staticProjectionBypassDepth++;
    try {
        return callback();
    } finally {
        staticProjectionBypassDepth--;
    }
}

/**
 * Uses an explicitly persisted static projection when one exists. Other
 * bindings fall through to the regular evaluator so Vue can resolve them with
 * the same component context during SSR and initial hydration.
 */
export function resolveStaticBinding(rawValue: unknown): StaticBindingResolution {
    if (staticProjectionBypassDepth || !active?.value || !isDynamicBinding(rawValue)) return;

    if (rawValue.__wwtype === 'f' && Object.hasOwn(rawValue, 'staticValue') && rawValue.staticValue !== undefined) {
        return { value: rawValue.staticValue };
    }

    return;
}

function isDynamicBinding(value: unknown): value is {
    __wwtype: 'd' | 'f' | 'js';
    code?: unknown;
    staticValue?: unknown;
} {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    if (!Object.hasOwn(value, '__wwtype')) return false;

    const type = (value as { __wwtype?: unknown }).__wwtype;
    return type === 'd' || type === 'f' || type === 'js';
}
