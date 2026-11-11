import { onScopeDispose, unref, watchEffect, type Ref } from 'vue';

import type { FormulaExecutor } from '@/_common/helpers/formulaExecutor';
import type { StyleSurfaceKind } from '@/_common/helpers/styleCompiler';
import { isStaticRenderingActive } from '@/_front/rendering/staticRenderingContext';
import { isStyleCompilerPrerenderRuntimeActive } from '@/_front/rendering/styleCompilerPrerenderRuntime';
import { getMountedComponentId, WW_COMPONENT_ID_ATTRIBUTE } from '@/_front/services/componentIds';
import { prerenderStyleFormulaExecutor, styleFormulaExecutor } from '@/_front/services/styleFormulaExecutor';
import {
    createStyleCompilerRuntimeVariableRegistrationKey,
    isStyleCompilerRuntimeVariableValueAccepted,
    setStyleCompilerRuntimeClear,
    setStyleCompilerRuntimeVariable,
    setStyleCompilerRuntimeVariableClear,
} from '@/_front/services/styleCompilerRuntimeStyleSheet';
import { getStyleDynamicVariablesForSource } from '@/_front/services/styleCompilerRuntimeVariables';
import { resolveStyleCompilerRuntimeVariableResult } from '@/_front/services/styleCompilerRuntimeVariableResolver';

type RuntimeVariableTargetRefs = {
    element?: Ref<unknown>;
    sectionContainer?: Ref<unknown>;
    sectionElement?: Ref<unknown>;
};

type RuntimeVariableTargetId = string | number | Ref<string | number | undefined>;

type RuntimeVariableTargetIds = {
    element?: RuntimeVariableTargetId;
    sectionContainer?: RuntimeVariableTargetId;
    sectionElement?: RuntimeVariableTargetId;
};

type UseStyleCompilerDynamicVariablesOptions = {
    sourceUid: string | Ref<string | undefined>;
    context?: Record<string, unknown>;
    targets: RuntimeVariableTargetRefs;
    targetIds?: RuntimeVariableTargetIds;
};

type RuntimeStyleRegistration = {
    fingerprint: string;
    stop: () => void;
};

const warnedMissingComponentIdElements = new WeakSet<HTMLElement>();
const warnedUnresolvedPrerenderVariables = new Set<string>();

/**
 * Writes dynamic/formula CSS variable values onto the rendered node that owns the matching CSS.
 */
export function useStyleCompilerDynamicVariables({
    sourceUid,
    context = {},
    targets,
    targetIds = {},
}: UseStyleCompilerDynamicVariablesOptions) {
    const registrations = new Map<string, RuntimeStyleRegistration>();

    if (isStyleCompilerPrerenderRuntimeActive()) {
        watchEffect(() => {
            synchronizeRuntimeStyleVariables({
                sourceUid,
                context,
                registrations,
                executor: prerenderStyleFormulaExecutor,
                resolveComponentId: kind => resolveVariableTargetId(kind, targetIds),
                prerender: true,
            });
        });

        // Vue disposes server-rendered scopes before renderToString resolves. The render-scoped
        // stylesheet intentionally owns these registrations until it is serialized by entry-server.
        return;
    }

    watchEffect(() => {
        if (isStaticRenderingActive()) return;

        synchronizeRuntimeStyleVariables({
            sourceUid,
            context,
            registrations,
            executor: styleFormulaExecutor,
            resolveComponentId: kind => resolveRuntimeVariableTargetId(kind, targets, targetIds),
            prerender: false,
        });
    });

    onScopeDispose(() => {
        for (const registration of registrations.values()) {
            registration.stop();
        }
        registrations.clear();
    });
}

function synchronizeRuntimeStyleVariables({
    sourceUid,
    context,
    registrations,
    executor,
    resolveComponentId,
    prerender,
}: {
    sourceUid: string | Ref<string | undefined>;
    context: Record<string, unknown>;
    registrations: Map<string, RuntimeStyleRegistration>;
    executor: FormulaExecutor<Record<string, unknown>>;
    resolveComponentId: (kind: StyleSurfaceKind) => string | null;
    prerender: boolean;
}) {
    const seenRegistrationKeys = new Set<string>();
    const variables = getStyleDynamicVariablesForSource(sourceUid);
    const executionResults = new Map();

    for (const variable of variables) {
        if (prerender && variable.breakpoint !== 'default') continue;

        const componentId = resolveComponentId(variable.surface.kind);
        if (!componentId) continue;

        const registrationKey = createStyleCompilerRuntimeVariableRegistrationKey(componentId, variable);
        seenRegistrationKeys.add(registrationKey);

        const resolution = resolveStyleCompilerRuntimeVariableResult({
            variable,
            context,
            executor,
            executionResults,
        });
        if (resolution.status === 'empty') {
            replaceRuntimeStyleRegistration(registrations, registrationKey, 'empty', () =>
                setStyleCompilerRuntimeClear({ componentId, variable })
            );
            continue;
        }
        if (resolution.status === 'inactive') {
            replaceRuntimeStyleRegistration(registrations, registrationKey, 'inactive', () =>
                setStyleCompilerRuntimeVariableClear({ componentId, variable })
            );
            continue;
        }
        if (resolution.status !== 'value') {
            removeRuntimeStyleRegistration(registrations, registrationKey);
            if (prerender && !warnedUnresolvedPrerenderVariables.has(registrationKey)) {
                warnedUnresolvedPrerenderVariables.add(registrationKey);
                wwLib.wwLog.warn('[style-compiler] unable to resolve prerendered runtime CSS variable', {
                    sourceUid: variable.sourceUid,
                    surface: variable.surface.key,
                    property: variable.property,
                    state: variable.state,
                    breakpoint: variable.breakpoint,
                });
            }
            continue;
        }

        const fingerprint = `value\u001f${resolution.cssValue}`;
        if (registrations.get(registrationKey)?.fingerprint === fingerprint) continue;
        if (!isStyleCompilerRuntimeVariableValueAccepted(variable, resolution.cssValue)) continue;

        replaceRuntimeStyleRegistration(registrations, registrationKey, fingerprint, () =>
            setStyleCompilerRuntimeVariable({ componentId, variable, cssValue: resolution.cssValue })
        );
    }

    for (const registrationKey of registrations.keys()) {
        if (!seenRegistrationKeys.has(registrationKey)) {
            removeRuntimeStyleRegistration(registrations, registrationKey);
        }
    }
}

function replaceRuntimeStyleRegistration(
    registrations: Map<string, RuntimeStyleRegistration>,
    registrationKey: string,
    fingerprint: string,
    create: () => () => void
) {
    const current = registrations.get(registrationKey);
    if (current?.fingerprint === fingerprint) return;

    current?.stop();
    registrations.set(registrationKey, { fingerprint, stop: create() });
}

function removeRuntimeStyleRegistration(registrations: Map<string, RuntimeStyleRegistration>, registrationKey: string) {
    const registration = registrations.get(registrationKey);
    if (!registration) return;

    registration.stop();
    registrations.delete(registrationKey);
}

function resolveRuntimeVariableTargetId(
    kind: StyleSurfaceKind,
    targets: RuntimeVariableTargetRefs,
    targetIds: RuntimeVariableTargetIds
) {
    const targetKey = getVariableTargetKey(kind);

    // A component's $el can be a fragment anchor when development comments are retained.
    // Supplied IDs also track whether the surface is rendered; undefined must clear its styles.
    if (Object.hasOwn(targetIds, targetKey)) return toRuntimeComponentId(targetIds[targetKey]);

    const element = toHtmlElement(targets[targetKey]);
    return element ? getRuntimeComponentId(element) : null;
}

function getVariableTargetKey(kind: StyleSurfaceKind): keyof RuntimeVariableTargetIds {
    if (kind === 'section-container') return 'sectionContainer';
    if (kind === 'section-element' || kind === 'section-layout') return 'sectionElement';
    return 'element';
}

function resolveVariableTargetId(kind: StyleSurfaceKind, targetIds: RuntimeVariableTargetIds) {
    return toRuntimeComponentId(targetIds[getVariableTargetKey(kind)]);
}

function toRuntimeComponentId(value: RuntimeVariableTargetId | undefined): string | null {
    const componentId = unref(value);
    if (typeof componentId === 'string') return componentId || null;
    if (typeof componentId === 'number') return `${componentId}`;
    return null;
}

function toHtmlElement(refValue: Ref<unknown> | undefined): HTMLElement | null {
    const value = unref(unref(refValue) as Ref<unknown> | unknown);
    if (!value) return null;
    if (isHtmlElement(value)) return value;

    const maybeComponent = value as { $el?: unknown };
    return isHtmlElement(maybeComponent.$el) ? maybeComponent.$el : null;
}

function isHtmlElement(value: unknown): value is HTMLElement {
    return !!value && typeof value === 'object' && (value as Node).nodeType === 1 && 'style' in value;
}

function getRuntimeComponentId(element: HTMLElement) {
    const componentId = getMountedComponentId(element);
    if (componentId) return componentId;

    if (!warnedMissingComponentIdElements.has(element)) {
        warnedMissingComponentIdElements.add(element);
        wwLib.wwLog.warn(`[style-compiler] missing ${WW_COMPONENT_ID_ATTRIBUTE} on runtime CSS variable target`, {
            element,
        });
    }

    return null;
}
