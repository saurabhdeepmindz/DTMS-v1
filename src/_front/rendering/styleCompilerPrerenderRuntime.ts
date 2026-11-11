import { serializeStyleCompilerRuntimeStyleSheet } from '@/_front/services/styleCompilerRuntimeStyleSheet';

let active = false;
const PRERENDERED_RUNTIME_STYLE_SELECTOR = 'style[data-ww-style-compiler-prerendered]';

/**
 * Opens the render-scoped projection of the client runtime stylesheet.
 *
 * Route rendering runs in an isolated process and document. Keeping this state append-only until
 * renderToString completes lets disposed Vue scopes leave their final CSS declarations in place.
 */
export function prepareStyleCompilerPrerenderRuntime(): void {
    active = true;
}

/** Returns the resolved runtime CSS for the rendered route and closes the projection. */
export function completeStyleCompilerPrerenderRuntime(): string {
    try {
        return serializeStyleCompilerRuntimeStyleSheet();
    } finally {
        active = false;
    }
}

/** Closes an interrupted projection without attempting to serialize partial output. */
export function cancelStyleCompilerPrerenderRuntime(): void {
    active = false;
}

export function isStyleCompilerPrerenderRuntimeActive(): boolean {
    return active;
}

/** Removes the server projection only after the hydrated runtime sheet has flushed. */
export function removeStyleCompilerPrerenderRuntime(doc: Pick<Document, 'querySelectorAll'> = document): void {
    const styleElements = doc.querySelectorAll(PRERENDERED_RUNTIME_STYLE_SELECTOR);
    for (const styleElement of styleElements) {
        styleElement.remove();
    }
}
