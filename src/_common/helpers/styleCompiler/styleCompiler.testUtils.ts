import { expect } from 'vitest';
import { effectScope, watchEffect } from 'vue';

import {
    createElementSelector,
    createStringStyleSheetAdapter,
    type StyleBreakpointPropertyReader,
    type StyleClassReader,
    type StyleComponentCapabilities,
    type StyleDiagnostic,
    type StyleDynamicVariable,
    type StyleElementReader,
    type StyleParentRef,
    type StyleReader,
    type StyleReactivityRuntime,
    type StyleScopeDispose,
    type StyleSectionReader,
    type StyleStateDescriptor,
    type StyleStateReader,
    type StyleSurface,
} from './index';

export type TestSourceData = {
    uid: string;
    styleSourceId?: number;
    baseId?: string;
    libraryComponentBaseId?: string;
    parentLibraryComponentId?: string;
    stateNames?: string[];
    states?: StyleStateDescriptor[];
    selector?: string;
    parentRef?: StyleParentRef;
    isDirectSectionChild?: boolean;
    capabilities?: StyleComponentCapabilities;
    emitDefaultDeclarations?: boolean;
    classIds?: Record<string, string[]>;
    subClassIds?: Record<string, Record<string, string[]>>;
    nonStatefulProperties?: Partial<Record<'styles' | 'content', readonly string[]>>;
    styles?: Record<string, Record<string, Record<string, unknown>>>;
    content?: Record<string, Record<string, Record<string, unknown>>>;
    effectiveFallback?: TestSourceData;
};

export type TestClassData = TestSourceData & {
    subClasses?: Record<string, TestClassData>;
};

type ManualStyleScope = {
    runCount: number;
    stopCount: number;
    run<TResult>(callback: () => TResult): TResult | undefined;
    addEffect(effect: ManualStyleEffect): void;
    rerun(): void;
    stop(): void;
};

type ManualStyleEffect = {
    callback: (onDispose: StyleScopeDispose) => void;
    cleanups: Array<() => void>;
    stopped: boolean;
};

export function createManualStyleReactivityRuntime() {
    const scopes: ManualStyleScope[] = [];
    const activeScopes: ManualStyleScope[] = [];
    const runtime: StyleReactivityRuntime = {
        createScope() {
            const scope = createManualStyleScope(activeScopes);
            scopes.push(scope);
            return scope;
        },
        effect(callback) {
            const activeScope = activeScopes[activeScopes.length - 1];
            const effect: ManualStyleEffect = {
                callback,
                cleanups: [],
                stopped: false,
            };

            activeScope?.addEffect(effect);
            runManualStyleEffect(activeScope, effect);

            return () => {
                stopManualStyleEffect(effect);
            };
        },
    };

    return { runtime, scopes };
}

function createManualStyleScope(activeScopes: ManualStyleScope[]): ManualStyleScope {
    const effects: ManualStyleEffect[] = [];
    let stopped = false;
    const scope: ManualStyleScope = {
        runCount: 0,
        stopCount: 0,
        run(callback) {
            if (stopped) return undefined;

            activeScopes.push(scope);
            try {
                return callback();
            } finally {
                removeManualActiveScope(activeScopes, scope);
            }
        },
        addEffect(effect) {
            if (stopped) {
                stopManualStyleEffect(effect);
                return;
            }

            effects.push(effect);
        },
        rerun() {
            if (stopped) return;

            for (const effect of effects) {
                runManualStyleEffect(scope, effect);
            }
        },
        stop() {
            if (stopped) return;

            stopped = true;
            scope.stopCount++;
            for (let index = effects.length - 1; index >= 0; index--) {
                stopManualStyleEffect(effects[index]);
            }
        },
    };

    return scope;
}

function runManualStyleEffect(scope: ManualStyleScope | undefined, effect: ManualStyleEffect) {
    if (effect.stopped) return;

    cleanupScope(effect.cleanups);
    if (scope) {
        scope.runCount++;
    }
    effect.callback(cleanup => {
        effect.cleanups.push(cleanup);
    });
}

function stopManualStyleEffect(effect: ManualStyleEffect) {
    if (effect.stopped) return;

    effect.stopped = true;
    cleanupScope(effect.cleanups);
}

function cleanupScope(cleanups: Array<() => void>) {
    for (let index = cleanups.length - 1; index >= 0; index--) {
        cleanups[index]();
    }
    cleanups.length = 0;
}

function removeManualActiveScope(activeScopes: ManualStyleScope[], scope: ManualStyleScope) {
    for (let index = activeScopes.length - 1; index >= 0; index--) {
        if (activeScopes[index] !== scope) continue;

        activeScopes.splice(index, 1);
        return;
    }
}

export function createVueStyleCompilerTestRuntime(): StyleReactivityRuntime {
    return {
        createScope() {
            return effectScope();
        },
        effect: watchEffect,
    };
}

export function createWidthElement(uid: string, width: string): TestSourceData {
    return {
        uid,
        styles: {
            base: {
                default: {
                    width,
                },
            },
        },
    };
}

export function expectTargetChunkOrder(css: string, uid: string) {
    const selector = createElementSelector(uid);
    const baseIndex = css.indexOf(`${selector} {`);
    const tabletIndex = css.indexOf('@media (max-width: 991px)', baseIndex);
    const hoverIndex = css.indexOf(`${selector}:where(:hover) {`);

    expect(baseIndex).toBeGreaterThanOrEqual(0);
    expect(tabletIndex).toBeGreaterThan(baseIndex);
    expect(hoverIndex).toBeGreaterThan(tabletIndex);
}

export function createReader({
    elements = {},
    sections = {},
    libraryComponents = {},
    classes = {},
}: {
    elements?: Record<string, TestSourceData>;
    sections?: Record<string, TestSourceData>;
    libraryComponents?: Record<string, { rootElementUid?: string; childLibraryComponentIds?: readonly string[] }>;
    classes?: Record<string, TestClassData>;
}): StyleReader {
    return {
        element(uid) {
            const data = elements[uid];
            return data ? createElementReader(data) : null;
        },
        section(uid) {
            const data = sections[uid];
            return data ? createSectionReader(data) : null;
        },
        libraryComponent(id) {
            const data = libraryComponents[id];
            return data
                ? {
                      rootElementUid: () => data.rootElementUid,
                      childLibraryComponentIds: () => data.childLibraryComponentIds || [],
                  }
                : null;
        },
        styleClass(id) {
            const data = classes[id];
            return data ? createClassReader(data) : null;
        },
    };
}

function createElementReader(data: TestSourceData): StyleElementReader {
    return {
        ...createSourceReader(data),
        kind: () => 'element',
        isLibraryComponentInstance: () => !!data.libraryComponentBaseId,
        effectiveFallbackSource: () => (data.effectiveFallback ? createElementReader(data.effectiveFallback) : null),
        isDirectSectionChild: () => data.isDirectSectionChild ?? false,
    };
}

function createSectionReader(data: TestSourceData): StyleSectionReader {
    return {
        ...createSourceReader(data),
        kind: () => 'section',
    };
}

function createSourceReader(data: TestSourceData) {
    return {
        uid: () => data.uid,
        styleSourceId: () => data.styleSourceId,
        baseId: () => data.baseId,
        capabilities: () => data.capabilities || {},
        states: () => data.states || (data.stateNames || inferStateNames(data)).map(id => ({ id })),
        emitDefaultDeclarations: () => data.emitDefaultDeclarations ?? true,
        parentRef: () => data.parentRef,
        selector: () => data.selector,
        style: () => createPropertyTreeReader(data, 'styles'),
        content: () => createPropertyTreeReader(data, 'content'),
    };
}

function createClassReader(data: TestClassData): StyleClassReader {
    return {
        style: () => createPropertyTreeReader(data, 'styles'),
        content: () => createPropertyTreeReader(data, 'content'),
        subClass(id) {
            const subClassData = data.subClasses?.[id];
            return subClassData ? createClassReader(subClassData) : null;
        },
    };
}

function createPropertyTreeReader(data: TestSourceData, domain: 'styles' | 'content') {
    return {
        supportsState: (property: string) => !data.nonStatefulProperties?.[domain]?.includes(property),
        state: (name: string) => createStateReader(data, domain, name),
    };
}

function createStateReader(data: TestSourceData, domain: 'styles' | 'content', state: string): StyleStateReader {
    return {
        classIds: () => data.classIds?.[state] || [],
        subClassIds: classId => data.subClassIds?.[state]?.[classId] || [],
        breakpoint: breakpoint => createBreakpointReader(data[domain]?.[state]?.[breakpoint] || {}),
    };
}

function createBreakpointReader(style: Record<string, unknown>): StyleBreakpointPropertyReader {
    return {
        property: name => style[name],
        customCss: () => style.customCss,
        customCssProperty(name) {
            const customCss = style.customCss;
            if (!customCss || typeof customCss !== 'object' || Array.isArray(customCss)) return undefined;
            return (customCss as Record<string, unknown>)[name];
        },
        customCssEntries() {
            const customCss = style.customCss;
            if (!customCss || typeof customCss !== 'object' || Array.isArray(customCss) || '__wwtype' in customCss) {
                return [];
            }

            return Object.entries(customCss as Record<string, unknown>);
        },
    };
}

function inferStateNames(data: TestSourceData) {
    return [...new Set([...Object.keys(data.styles || {}), ...Object.keys(data.content || {})])].filter(
        state => state !== 'base'
    );
}

export function createDiagnosticStringStyleSheetAdapter(diagnostics: StyleDiagnostic[]) {
    const stylesheet = createStringStyleSheetAdapter();
    return {
        ...stylesheet,
        diagnostic(diagnostic: StyleDiagnostic) {
            diagnostics.push(diagnostic);
        },
    };
}

export function createDynamicVariableStringStyleSheetAdapter(variables: StyleDynamicVariable[]) {
    const stylesheet = createStringStyleSheetAdapter();
    return {
        ...stylesheet,
        dynamicVariable(variable: StyleDynamicVariable) {
            variables.push(variable);
        },
    };
}

export function createDynamicVariableCleanupStyleSheetAdapter(
    variables: Map<string, StyleDynamicVariable>,
    onCleanup: () => void
) {
    const stylesheet = createStringStyleSheetAdapter();
    return {
        ...stylesheet,
        dynamicVariable(variable: StyleDynamicVariable) {
            variables.set(variable.name, variable);
            return () => {
                onCleanup();
                variables.delete(variable.name);
            };
        },
    };
}

export function createTestStyleSurface(uid: string): StyleSurface {
    return {
        key: `element:${uid}`,
        group: 'element',
        kind: 'element',
        selector: createElementSelector(uid),
    };
}
