import { shallowRef, unref, type Ref } from 'vue';

import type { StyleDynamicVariable, StyleScopeStop, StyleSurfaceKind } from '@/_common/helpers/styleCompiler';

type StyleDynamicVariableBucket = {
    registrationsByKey: Map<string, StyleDynamicVariableRegistration>;
    version: Ref<number>;
};

type StyleDynamicVariableRegistration = {
    variable: StyleDynamicVariable;
    previous?: StyleDynamicVariableRegistration;
    next?: StyleDynamicVariableRegistration;
    active: boolean;
};

const variablesBySourceUid = new Map<string, StyleDynamicVariableBucket>();
const registryVersion = shallowRef(0);
const pendingVersionBuckets = new Set<StyleDynamicVariableBucket>();
let shouldBumpRegistryVersion = false;
let isVersionFlushScheduled = false;

/**
 * Registers a dynamic value emitted by the compiler.
 *
 * The returned cleanup is called by the target chunk that emitted the variable. This keeps formula
 * CSS-var writers aligned with the live stylesheet rules.
 */
export function registerStyleDynamicVariable(variable: StyleDynamicVariable): StyleScopeStop {
    const bucket = getOrCreateSourceBucket(variable.sourceUid);
    const key = createVariableKey(variable);
    const previousRegistration = bucket.registrationsByKey.get(key);
    const registration: StyleDynamicVariableRegistration = {
        variable,
        previous: previousRegistration,
        active: true,
    };

    if (previousRegistration) previousRegistration.next = registration;
    bucket.registrationsByKey.set(key, registration);
    bumpVersion(bucket);

    return () => {
        if (!registration.active) return;

        registration.active = false;
        const isLatestRegistration = bucket.registrationsByKey.get(key) === registration;
        const { previous, next } = registration;

        if (previous) previous.next = next;
        if (next) next.previous = previous;
        registration.previous = undefined;
        registration.next = undefined;

        if (!isLatestRegistration) return;

        if (previous) {
            bucket.registrationsByKey.set(key, previous);
        } else {
            bucket.registrationsByKey.delete(key);
        }
        bumpVersion(bucket);
        if (!bucket.registrationsByKey.size) {
            variablesBySourceUid.delete(variable.sourceUid);
            bumpRegistryVersion();
        }
    };
}

/** Registers one published page manifest under a single lifecycle cleanup. */
export function registerStyleDynamicVariables(variables: readonly StyleDynamicVariable[]): StyleScopeStop {
    const cleanups: StyleScopeStop[] = [];
    for (const variable of variables) {
        cleanups.push(registerStyleDynamicVariable(variable));
    }

    return () => {
        for (let index = cleanups.length - 1; index >= 0; index--) {
            cleanups[index]();
        }
        cleanups.length = 0;
    };
}

/**
 * Reads variables for one style source and tracks registry changes in Vue effects.
 */
export function getStyleDynamicVariablesForSource(
    sourceUid: string | Ref<string | undefined>,
    surfaceKinds?: ReadonlySet<StyleSurfaceKind>
) {
    const uid = unref(sourceUid);
    if (!uid) return [];

    registryVersion.value;
    const bucket = variablesBySourceUid.get(uid);
    if (!bucket) return [];

    bucket.version.value;

    return [...bucket.registrationsByKey.values()]
        .map(registration => registration.variable)
        .filter(variable => {
            if (variable.sourceUid !== uid) return false;
            return !surfaceKinds || surfaceKinds.has(variable.surface.kind);
        });
}

function createVariableKey(variable: StyleDynamicVariable) {
    return [
        variable.group,
        variable.surface.key,
        variable.selector,
        variable.domain,
        variable.property,
        variable.state,
        variable.breakpoint,
        variable.name,
        variable.kind || '',
        variable.keyframesName || '',
        variable.outputKey || '',
        variable.omitWhenUndefined ? 'omit-undefined' : '',
        stringifyDynamicVariableValueNormalizer(variable.valueNormalizer),
        variable.cssProperty,
        variable.validationProperty,
    ].join('\u001f');
}

function stringifyDynamicVariableValueNormalizer(valueNormalizer: StyleDynamicVariable['valueNormalizer']) {
    if (!valueNormalizer) return '';

    return JSON.stringify(valueNormalizer);
}

function getOrCreateSourceBucket(sourceUid: string): StyleDynamicVariableBucket {
    let bucket = variablesBySourceUid.get(sourceUid);
    if (bucket) return bucket;

    bucket = {
        registrationsByKey: new Map(),
        version: shallowRef(0),
    };
    variablesBySourceUid.set(sourceUid, bucket);
    bumpRegistryVersion();
    return bucket;
}

function bumpVersion(bucket: StyleDynamicVariableBucket) {
    pendingVersionBuckets.add(bucket);
    scheduleVersionFlush();
}

function bumpRegistryVersion() {
    shouldBumpRegistryVersion = true;
    scheduleVersionFlush();
}

function scheduleVersionFlush() {
    if (isVersionFlushScheduled) return;

    isVersionFlushScheduled = true;
    queueMicrotask(flushVersionUpdates);
}

function flushVersionUpdates() {
    isVersionFlushScheduled = false;

    for (const bucket of pendingVersionBuckets) {
        bucket.version.value++;
    }
    pendingVersionBuckets.clear();

    if (!shouldBumpRegistryVersion) return;

    shouldBumpRegistryVersion = false;
    registryVersion.value++;
}
