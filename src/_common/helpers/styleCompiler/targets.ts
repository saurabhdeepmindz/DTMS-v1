import {
    createElementLayoutStyleSurface,
    createElementStyleSurface,
    createSectionLayoutStyleSurface,
    createSectionStyleSurface,
} from './selectors';
import { sourceInheritsLayout } from './capabilities';
import type {
    StyleCompilerInput,
    StyleElementReader,
    StyleLibraryLayer,
    StyleRuleGroup,
    StyleSectionReader,
    StyleSurfaceKind,
} from './types';

export type StyleSourceReader = StyleElementReader | StyleSectionReader;

export type ElementStyleTargetDescriptor = {
    key: string;
    group: Extract<StyleRuleGroup, 'library' | 'element'>;
    kind: Extract<StyleSurfaceKind, 'element'>;
    uid: string;
    emitDefaultDeclarations?: boolean;
};

export type SectionStyleTargetDescriptor = {
    key: string;
    group: Extract<StyleRuleGroup, 'section'>;
    kind: Extract<StyleSurfaceKind, 'section-container' | 'section-element'>;
    uid: string;
    emitDefaultDeclarations?: boolean;
};

export type SourceStyleTargetDescriptor = ElementStyleTargetDescriptor | SectionStyleTargetDescriptor;

export type StyleTargetDescriptor = SourceStyleTargetDescriptor;

/**
 * Builds the target list the stylesheet should contain.
 *
 * The root reactive scope only reconciles this list. Existing target scopes stay alive across
 * reorders because targets are keyed by rendered surface, not by position in the page arrays.
 */
export function createStyleTargetDescriptors(input: StyleCompilerInput) {
    const targets: StyleTargetDescriptor[] = [];
    const seenTargetKeys = new Set<string>();
    const libraryElementUids = new Set<string>();

    // Library component definitions are the lowest-priority generated CSS group. If an instance
    // source targets the same rendered element later, the instance group must win.
    const sortedLibraryComponentIds = sortLibraryComponentIdsTopologically(input.scope.libraryComponentIds, input.reader);

    for (const libraryComponentId of sortedLibraryComponentIds) {
        const rootElementUid = input.reader.libraryComponent(libraryComponentId)?.rootElementUid();
        if (!rootElementUid) continue;

        addElementTargetDescriptor(targets, seenTargetKeys, rootElementUid, 'library');
        libraryElementUids.add(rootElementUid);
    }

    for (const elementUid of input.scope.libraryElementUids || []) {
        addElementTargetDescriptor(targets, seenTargetKeys, elementUid, 'library');
        libraryElementUids.add(elementUid);
    }

    // Sections have two styling surfaces in the rendered DOM: the outer section container and the
    // inner `.ww-section-element`. They share one data source but emit different rules.
    for (const sectionUid of input.scope.sectionUids) {
        addSectionTargetDescriptor(targets, seenTargetKeys, sectionUid, 'section-container');
        addSectionTargetDescriptor(targets, seenTargetKeys, sectionUid, 'section-element');
    }

    for (const elementUid of input.scope.elementUids) {
        if (libraryElementUids.has(elementUid)) continue;

        addElementTargetDescriptor(targets, seenTargetKeys, elementUid, 'element');
    }

    return targets;
}

/**
 * Orders library component definitions dependency-first.
 *
 * If component A renders component B in its definition, B must be emitted before A so A's root
 * styles can override B's default root styles through normal CSS order. Cycles are invalid data; the
 * traversal fails soft by keeping a stable best-effort order.
 */
function sortLibraryComponentIdsTopologically(
    libraryComponentIds: readonly string[],
    reader: StyleCompilerInput['reader']
) {
    const orderedInputIds = uniqueStrings(libraryComponentIds);
    const knownIds = new Set(orderedInputIds);
    const visitingIds = new Set<string>();
    const visitedIds = new Set<string>();
    const result: string[] = [];

    for (const libraryComponentId of orderedInputIds) {
        visitLibraryComponentId(libraryComponentId);
    }

    return result;

    function visitLibraryComponentId(libraryComponentId: string) {
        if (visitedIds.has(libraryComponentId)) return;
        if (visitingIds.has(libraryComponentId)) return;

        visitingIds.add(libraryComponentId);

        const childLibraryComponentIds = reader.libraryComponent(libraryComponentId)?.childLibraryComponentIds?.() || [];

        for (const childLibraryComponentId of childLibraryComponentIds) {
            if (knownIds.has(childLibraryComponentId)) visitLibraryComponentId(childLibraryComponentId);
        }

        visitingIds.delete(libraryComponentId);
        visitedIds.add(libraryComponentId);
        result.push(libraryComponentId);
    }
}

function uniqueStrings(values: readonly string[]) {
    return [...new Set(values.filter(value => typeof value === 'string' && !!value))];
}

/**
 * Reads the current source for a target.
 *
 * Reactive editor readers should make this method track the source by uid. That lets a target scope
 * survive page-scope reorders while still rerunning if its backing source object is replaced.
 */
export function readStyleTargetSource(
    reader: StyleCompilerInput['reader'],
    target: StyleTargetDescriptor
): StyleSourceReader | null {
    if (target.kind === 'element') return reader.element(target.uid);

    return reader.section(target.uid);
}

/**
 * Builds the CSS surfaces for a target from the current source reader.
 */
export function createStyleTargetSurfaces(source: StyleSourceReader, target: StyleTargetDescriptor) {
    if (target.kind === 'element') {
        const elementSource = source as StyleElementReader;
        const libraryLayer = getLibraryLayer(elementSource, target.group);
        const surfaces = [createElementStyleSurface(elementSource, target.group, { libraryLayer })];
        if (sourceInheritsLayout(elementSource)) {
            surfaces.push(createElementLayoutStyleSurface(elementSource, target.group, { libraryLayer }));
        }

        return surfaces;
    }

    if (target.kind === 'section-element') {
        const sectionSource = source as StyleSectionReader;
        const surfaces = [createSectionStyleSurface(sectionSource, target.kind, target.group)];
        if (sourceInheritsLayout(sectionSource)) surfaces.push(createSectionLayoutStyleSurface(sectionSource, target.group));

        return surfaces;
    }

    return [createSectionStyleSurface(source as StyleSectionReader, target.kind, target.group)];
}

function getLibraryLayer(source: StyleElementReader, group: StyleRuleGroup): StyleLibraryLayer | undefined {
    if (group !== 'library') return undefined;

    return source.isLibraryComponentInstance?.() ? 'instance' : 'definition';
}

/**
 * Creates the target descriptor for one section DOM surface.
 */
function addSectionTargetDescriptor(
    targets: StyleTargetDescriptor[],
    seenTargetKeys: Set<string>,
    uid: string,
    kind: Extract<StyleSurfaceKind, 'section-container' | 'section-element'>
): void {
    const key = `section:${kind}:${uid}`;
    if (seenTargetKeys.has(key)) return;

    seenTargetKeys.add(key);
    targets.push({
        key,
        group: 'section',
        kind,
        uid,
    });
}

/**
 * Adds one element target if it was not already covered inside the same cascade group.
 */
function addElementTargetDescriptor(
    targets: StyleTargetDescriptor[],
    seenTargetKeys: Set<string>,
    uid: string,
    group: Extract<StyleRuleGroup, 'library' | 'element'>
) {
    const key = `${group}:element:${uid}`;
    if (seenTargetKeys.has(key)) return;

    seenTargetKeys.add(key);
    targets.push({
        key,
        group,
        kind: 'element',
        uid,
    });
}
