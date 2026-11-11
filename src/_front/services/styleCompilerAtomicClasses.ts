import { shallowReactive, shallowRef, unref, type Ref } from 'vue';

import type {
    StyleAtomicClassAssignment,
    StyleScopeStop,
    StyleSurfaceKind,
} from '@/_common/helpers/styleCompiler';

type AtomicClassBucket = {
    referencesByClassName: Map<string, number>;
    version: Ref<number>;
};
type PublishedAtomicClassNames = string | string[];

const buckets = shallowReactive(new Map<string, AtomicClassBucket>());
const publishedRegistrations = new Set<Map<string, PublishedAtomicClassNames>>();
const publishedRegistryVersion = shallowRef(0);

/** Registers one compiler-owned class and returns its reference-counted cleanup. */
export function registerStyleAtomicClass(assignment: StyleAtomicClassAssignment): StyleScopeStop {
    const key = createBucketKey(assignment.sourceUid, assignment.surfaceKind);
    let bucket = buckets.get(key);
    if (!bucket) {
        bucket = { referencesByClassName: new Map(), version: shallowRef(0) };
        buckets.set(key, bucket);
    }

    bucket.referencesByClassName.set(
        assignment.className,
        (bucket.referencesByClassName.get(assignment.className) || 0) + 1
    );
    bucket.version.value++;
    let active = true;

    return () => {
        if (!active || !bucket) return;

        active = false;
        const nextReferences = (bucket.referencesByClassName.get(assignment.className) || 1) - 1;
        if (nextReferences > 0) {
            bucket.referencesByClassName.set(assignment.className, nextReferences);
            return;
        }

        bucket.referencesByClassName.delete(assignment.className);
        bucket.version.value++;
        if (bucket.referencesByClassName.size) return;

        buckets.delete(key);
    };
}

/** Registers one published page manifest under a single lifecycle cleanup. */
export function registerStyleAtomicClasses(assignments: readonly StyleAtomicClassAssignment[]): StyleScopeStop {
    const registration = groupPublishedAtomicClassAssignments(assignments);
    publishedRegistrations.add(registration);
    publishedRegistryVersion.value++;

    let active = true;
    return () => {
        if (!active) return;
        active = false;
        publishedRegistrations.delete(registration);
        publishedRegistryVersion.value++;
    };
}

/** Returns the live classes for one concrete rendered surface. */
export function getStyleAtomicClassesForSource(
    sourceUid: string | Ref<string | undefined>,
    surfaceKind: StyleSurfaceKind
) {
    const uid = unref(sourceUid);
    if (!uid) return [];

    publishedRegistryVersion.value;
    const key = createBucketKey(uid, surfaceKind);
    const classNames = new Set<string>();
    const bucket = buckets.get(key);
    if (bucket) {
        bucket.version.value;
        for (const className of bucket.referencesByClassName.keys()) classNames.add(className);
    }

    for (const registration of publishedRegistrations) {
        const publishedClassNames = registration.get(key);
        if (Array.isArray(publishedClassNames)) {
            for (const className of publishedClassNames) classNames.add(className);
        } else if (publishedClassNames) {
            classNames.add(publishedClassNames);
        }
    }
    return [...classNames];
}

function createBucketKey(sourceUid: string, surfaceKind: StyleSurfaceKind) {
    return `${sourceUid}\u001f${surfaceKind}`;
}

function groupPublishedAtomicClassAssignments(assignments: readonly StyleAtomicClassAssignment[]) {
    const registrations = new Map<string, PublishedAtomicClassNames>();
    for (const assignment of assignments) {
        const key = createBucketKey(assignment.sourceUid, assignment.surfaceKind);
        const current = registrations.get(key);
        if (!current) {
            registrations.set(key, assignment.className);
        } else if (Array.isArray(current)) {
            if (!current.includes(assignment.className)) current.push(assignment.className);
        } else if (current !== assignment.className) {
            registrations.set(key, [current, assignment.className]);
        }
    }
    return registrations;
}
