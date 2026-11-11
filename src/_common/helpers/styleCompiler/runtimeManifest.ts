import type {
    StyleAtomicClassAssignment,
    StyleDynamicVariable,
    StyleDynamicVariableRuntimeFallback,
    StyleLibraryLayer,
    StylePropertyDomain,
    StyleRuleGroup,
    StyleSurfaceKind,
} from './types';

const LEGACY_MANIFEST_VERSION = 1 as const;
const ATOMIC_MANIFEST_VERSION = 2 as const;
const SURFACE_KINDS: readonly StyleSurfaceKind[] = [
    'element',
    'element-layout',
    'section-container',
    'section-element',
    'section-layout',
];
const RULE_GROUPS: readonly StyleRuleGroup[] = ['library', 'section', 'element'];
const LIBRARY_LAYERS: readonly StyleLibraryLayer[] = ['definition', 'instance'];
const PROPERTY_DOMAINS: readonly StylePropertyDomain[] = ['style', 'content'];
const BREAKPOINTS = ['default', 'tablet', 'mobile'] as const;

const OMIT_WHEN_UNDEFINED = 1;
const DIRECT_DECLARATION = 2;
const KEYFRAMES = 4;

type RuntimeManifestEntry = readonly unknown[];

export type StyleRuntimeManifest =
    | readonly [version: typeof LEGACY_MANIFEST_VERSION, variables: readonly RuntimeManifestEntry[]]
    | readonly [
          version: typeof ATOMIC_MANIFEST_VERSION,
          variables: readonly RuntimeManifestEntry[],
          atomicClasses: readonly RuntimeManifestEntry[],
      ];

export type StyleRuntimeManifestData = {
    variables: StyleDynamicVariable[];
    atomicClasses: StyleRuntimeAtomicClassAssignment[];
};

export type StyleRuntimeAtomicClassAssignment =
    | StyleAtomicClassAssignment
    | (Omit<StyleAtomicClassAssignment, 'sourceUid'> & { sourceIndex: number });

/**
 * Encodes runtime style metadata as versioned dense tuples.
 *
 * Repeated strings are intentionally left in the payload: gzip/Brotli compress them more
 * efficiently than a JSON string table while tuples still remove all repeated object keys.
 */
export function encodeStyleRuntimeManifest(
    variables: readonly StyleDynamicVariable[],
    atomicClasses: readonly StyleAtomicClassAssignment[] = [],
    atomicSourceIndexByUid?: ReadonlyMap<string, number>
): StyleRuntimeManifest {
    const encodedVariables = variables.map(encodeVariable);
    if (!atomicClasses.length) return [LEGACY_MANIFEST_VERSION, encodedVariables];

    return [ATOMIC_MANIFEST_VERSION, encodedVariables, encodeAtomicClasses(atomicClasses, atomicSourceIndexByUid)];
}

/**
 * Decodes one published page manifest. Invalid or newer payloads return `null`, allowing the front
 * to fall back to its legacy runtime compiler instead of breaking page rendering.
 */
export function decodeStyleRuntimeManifest(value: unknown): StyleDynamicVariable[] | null {
    return decodeStyleRuntimeManifestData(value)?.variables || null;
}

/** Decodes both the legacy variables-only format and the atomic class manifest. */
export function decodeStyleRuntimeManifestData(value: unknown): StyleRuntimeManifestData | null {
    if (!Array.isArray(value)) return null;
    if (value[0] === LEGACY_MANIFEST_VERSION && value.length !== 2) return null;
    if (value[0] === ATOMIC_MANIFEST_VERSION && value.length !== 3) return null;
    if (value[0] !== LEGACY_MANIFEST_VERSION && value[0] !== ATOMIC_MANIFEST_VERSION) return null;

    const entries = value[1];
    if (!Array.isArray(entries)) return null;

    const variables: StyleDynamicVariable[] = [];
    for (const entry of entries) {
        const variable = decodeVariable(entry);
        if (!variable) return null;
        variables.push(variable);
    }

    if (value[0] === LEGACY_MANIFEST_VERSION) return { variables, atomicClasses: [] };

    const atomicClasses = decodeAtomicClasses(value[2]);
    return atomicClasses ? { variables, atomicClasses } : null;
}

function encodeAtomicClasses(
    assignments: readonly StyleAtomicClassAssignment[],
    sourceIndexByUid?: ReadonlyMap<string, number>
): RuntimeManifestEntry[] {
    if (sourceIndexByUid) return encodeIndexedAtomicClasses(assignments, sourceIndexByUid);

    const sources = new Map<string | number, Map<StyleSurfaceKind, Set<string>>>();
    for (const assignment of assignments) {
        const source = sourceIndexByUid?.get(assignment.sourceUid) ?? assignment.sourceUid;
        let surfaces = sources.get(source);
        if (!surfaces) {
            surfaces = new Map();
            sources.set(source, surfaces);
        }

        let classNames = surfaces.get(assignment.surfaceKind);
        if (!classNames) {
            classNames = new Set();
            surfaces.set(assignment.surfaceKind, classNames);
        }
        classNames.add(assignment.className);
    }

    return [...sources].map(([sourceUid, surfaces]) => [
        sourceUid,
        ...[...surfaces].map(([surfaceKind, classNames]) => [SURFACE_KINDS.indexOf(surfaceKind), [...classNames]]),
    ]);
}

function encodeIndexedAtomicClasses(
    assignments: readonly StyleAtomicClassAssignment[],
    sourceIndexByUid: ReadonlyMap<string, number>
): RuntimeManifestEntry[] {
    const groups = new Map<string, { surfaceKind: StyleSurfaceKind; className: string; sourceIndexes: Set<number> }>();
    for (const assignment of assignments) {
        const sourceIndex = sourceIndexByUid.get(assignment.sourceUid);
        if (sourceIndex === undefined) continue;
        const key = `${assignment.surfaceKind}\u001f${assignment.className}`;
        let group = groups.get(key);
        if (!group) {
            group = { surfaceKind: assignment.surfaceKind, className: assignment.className, sourceIndexes: new Set() };
            groups.set(key, group);
        }
        group.sourceIndexes.add(sourceIndex);
    }

    return [...groups.values()].map(({ surfaceKind, className, sourceIndexes }) => [
        SURFACE_KINDS.indexOf(surfaceKind),
        className,
        [...sourceIndexes],
    ]);
}

function decodeAtomicClasses(value: unknown): StyleRuntimeAtomicClassAssignment[] | null {
    if (!Array.isArray(value)) return null;

    const assignments: StyleRuntimeAtomicClassAssignment[] = [];
    for (const sourceEntry of value) {
        if (
            Array.isArray(sourceEntry) &&
            sourceEntry.length === 3 &&
            typeof sourceEntry[1] === 'string' &&
            sourceEntry[1] &&
            Array.isArray(sourceEntry[2])
        ) {
            const surfaceKind = readAtomicSurfaceKind(sourceEntry[0]);
            if (!surfaceKind) return null;
            for (const sourceIndex of sourceEntry[2]) {
                if (!Number.isInteger(sourceIndex) || (sourceIndex as number) < 0) return null;
                assignments.push({
                    sourceIndex: sourceIndex as number,
                    surfaceKind,
                    className: sourceEntry[1],
                });
            }
            continue;
        }

        if (
            !Array.isArray(sourceEntry) ||
            sourceEntry.length < 2 ||
            (typeof sourceEntry[0] !== 'string' &&
                (!Number.isInteger(sourceEntry[0]) || (sourceEntry[0] as number) < 0))
        ) {
            return null;
        }

        for (const surfaceEntry of sourceEntry.slice(1)) {
            if (!Array.isArray(surfaceEntry) || surfaceEntry.length !== 2 || !Array.isArray(surfaceEntry[1])) {
                return null;
            }
            const surfaceKind = readAtomicSurfaceKind(surfaceEntry[0]);
            if (!surfaceKind) return null;

            for (const className of surfaceEntry[1]) {
                if (typeof className !== 'string' || !className) return null;
                assignments.push({
                    ...(typeof sourceEntry[0] === 'string'
                        ? { sourceUid: sourceEntry[0] }
                        : { sourceIndex: sourceEntry[0] as number }),
                    surfaceKind,
                    className,
                });
            }
        }
    }
    return assignments;
}

function readAtomicSurfaceKind(value: unknown) {
    return Number.isInteger(value) && (value as number) >= 0 && (value as number) < SURFACE_KINDS.length
        ? SURFACE_KINDS[value as number]
        : null;
}

function encodeVariable(variable: StyleDynamicVariable): RuntimeManifestEntry {
    const optionalEnumIndex = <T extends string>(values: readonly T[], value: T | undefined) =>
        value === undefined ? null : values.indexOf(value);
    const flags =
        (variable.omitWhenUndefined ? OMIT_WHEN_UNDEFINED : 0) |
        (variable.directDeclaration ? DIRECT_DECLARATION : 0) |
        (variable.kind === 'keyframes' ? KEYFRAMES : 0);
    const entry: unknown[] = [
        variable.name,
        variable.sourceUid,
        variable.surface.key,
        SURFACE_KINDS.indexOf(variable.surface.kind),
        variable.surface.selector,
        RULE_GROUPS.indexOf(variable.surface.group),
        PROPERTY_DOMAINS.indexOf(variable.domain),
        variable.property,
        variable.state,
        BREAKPOINTS.indexOf(variable.breakpoint),
        variable.value,
        variable.cssProperty,
        variable.selector,
        flags,
        variable.surface.runtimeScopeSelector ?? null,
        optionalEnumIndex(LIBRARY_LAYERS, variable.surface.libraryLayer),
        variable.group === variable.surface.group ? null : RULE_GROUPS.indexOf(variable.group),
        variable.outputKey ?? null,
        variable.valueNormalizer ?? null,
        variable.validationProperty ?? null,
        variable.condition ?? null,
        variable.runtimeFallback?.type === 'when-all-empty'
            ? {
                  // Preserve the legacy wire contract for older fronts: the primary value comes first.
                  values: [variable.value, ...variable.runtimeFallback.dependencies],
                  value: variable.runtimeFallback.value,
              }
            : null,
        variable.keyframesName ?? null,
        variable.runtimeFallback?.type === 'when-empty'
            ? {
                  // JSON omits undefined object properties, but older fronts require this field.
                  value: variable.runtimeFallback.value ?? null,
                  ...(variable.runtimeFallback.valueNormalizer
                      ? { valueNormalizer: variable.runtimeFallback.valueNormalizer }
                      : {}),
              }
            : null,
    ];

    while (entry[entry.length - 1] === null) entry.pop();
    return entry;
}

function decodeVariable(entry: unknown): StyleDynamicVariable | null {
    if (!Array.isArray(entry) || entry.length < 14 || entry.length > 24) return null;

    const readString = (value: unknown) => (typeof value === 'string' ? value : null);
    const readOptionalString = (value: unknown) =>
        value === null || value === undefined ? undefined : readString(value);
    const readEnum = <T>(values: readonly T[], index: unknown) =>
        Number.isInteger(index) && (index as number) >= 0 && (index as number) < values.length
            ? values[index as number]
            : null;
    const readOptionalEnum = <T>(values: readonly T[], index: unknown) =>
        index === null || index === undefined ? undefined : readEnum(values, index);

    const name = readString(entry[0]);
    const sourceUid = readString(entry[1]);
    const surfaceKey = readString(entry[2]);
    const surfaceKind = readEnum(SURFACE_KINDS, entry[3]);
    const surfaceSelector = readString(entry[4]);
    const surfaceGroup = readEnum(RULE_GROUPS, entry[5]);
    const domain = readEnum(PROPERTY_DOMAINS, entry[6]);
    const property = readString(entry[7]);
    const state = readString(entry[8]);
    const breakpoint = readEnum(BREAKPOINTS, entry[9]);
    const cssProperty = readString(entry[11]);
    const selector = readString(entry[12]);
    const flags = entry[13];
    if (
        name === null ||
        sourceUid === null ||
        surfaceKey === null ||
        surfaceKind === null ||
        surfaceSelector === null ||
        surfaceGroup === null ||
        domain === null ||
        property === null ||
        state === null ||
        breakpoint === null ||
        cssProperty === null ||
        selector === null ||
        !Number.isInteger(flags) ||
        (flags as number) < 0 ||
        ((flags as number) & ~(OMIT_WHEN_UNDEFINED | DIRECT_DECLARATION | KEYFRAMES)) !== 0
    ) {
        return null;
    }

    const runtimeScopeSelector = readOptionalString(entry[14]);
    const libraryLayer = readOptionalEnum(LIBRARY_LAYERS, entry[15]);
    const variableGroup = readOptionalEnum(RULE_GROUPS, entry[16]);
    const outputKey = readOptionalString(entry[17]);
    const validationProperty = readOptionalString(entry[19]);
    const keyframesName = readOptionalString(entry[22]);
    const runtimeFallback = decodeRuntimeFallback(entry[21], entry[23]);
    if (
        (entry[14] !== null && entry[14] !== undefined && runtimeScopeSelector === null) ||
        (entry[15] !== null && entry[15] !== undefined && libraryLayer === null) ||
        (entry[16] !== null && entry[16] !== undefined && variableGroup === null) ||
        (entry[17] !== null && entry[17] !== undefined && outputKey === null) ||
        (entry[19] !== null && entry[19] !== undefined && validationProperty === null) ||
        (entry[22] !== null && entry[22] !== undefined && keyframesName === null) ||
        runtimeFallback === null
    ) {
        return null;
    }

    const isKeyframes = ((flags as number) & KEYFRAMES) !== 0;
    if (isKeyframes !== (keyframesName !== undefined)) return null;

    const base = {
        name,
        surface: {
            key: surfaceKey,
            kind: surfaceKind,
            selector: surfaceSelector,
            group: surfaceGroup,
            ...(runtimeScopeSelector === undefined ? {} : { runtimeScopeSelector }),
            ...(libraryLayer === undefined ? {} : { libraryLayer }),
        },
        group: variableGroup || surfaceGroup,
        sourceUid,
        domain,
        property,
        state,
        breakpoint,
        value: entry[10],
        cssProperty,
        selector,
        ...(((flags as number) & OMIT_WHEN_UNDEFINED) === 0 ? {} : { omitWhenUndefined: true }),
        ...(((flags as number) & DIRECT_DECLARATION) === 0 ? {} : { directDeclaration: true }),
        ...(outputKey === undefined ? {} : { outputKey }),
        ...(entry[18] === null || entry[18] === undefined ? {} : { valueNormalizer: entry[18] }),
        ...(validationProperty === undefined ? {} : { validationProperty }),
        ...(entry[20] === null || entry[20] === undefined ? {} : { condition: entry[20] }),
        ...(runtimeFallback === undefined ? {} : { runtimeFallback }),
    };

    return isKeyframes
        ? ({ ...base, kind: 'keyframes', keyframesName } as StyleDynamicVariable)
        : (base as StyleDynamicVariable);
}

function decodeRuntimeFallback(
    whenAllEmpty: unknown,
    whenEmpty: unknown
): StyleDynamicVariableRuntimeFallback | null | undefined {
    const hasWhenAllEmpty = whenAllEmpty !== null && whenAllEmpty !== undefined;
    const hasWhenEmpty = whenEmpty !== null && whenEmpty !== undefined;
    if (hasWhenAllEmpty && hasWhenEmpty) return null;
    if (!hasWhenAllEmpty && !hasWhenEmpty) return undefined;

    if (hasWhenEmpty) {
        if (!isRecord(whenEmpty)) return null;
        const hasValue = Object.hasOwn(whenEmpty, 'value');
        // Older publications lost an undefined span value during JSON serialization.
        if (!hasValue && Object.keys(whenEmpty).some(key => key !== 'valueNormalizer')) return null;

        return {
            type: 'when-empty',
            value: hasValue ? whenEmpty.value : undefined,
            ...(whenEmpty.valueNormalizer === undefined ? {} : { valueNormalizer: whenEmpty.valueNormalizer }),
        } as StyleDynamicVariableRuntimeFallback;
    }

    if (
        !isRecord(whenAllEmpty) ||
        !Array.isArray(whenAllEmpty.values) ||
        whenAllEmpty.values.length === 0 ||
        !Object.hasOwn(whenAllEmpty, 'value')
    ) {
        return null;
    }

    return {
        type: 'when-all-empty',
        // Legacy manifests repeat the primary value at index 0. Internal metadata stores only
        // dependencies so formula identity does not depend on surviving JSON serialization.
        dependencies: whenAllEmpty.values.slice(1),
        value: whenAllEmpty.value,
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}
