import type { StoreRegistry } from '@/pinia/storeRegistry';
import { computed } from 'vue';

import {
    getComponentBaseConfiguration,
    getDisplayAllowedValues as getConfigurationDisplayAllowedValues,
} from '@/_common/helpers/component/component';
import { getInheritedConfiguration } from '@/_common/helpers/configuration/configuration';

import {
    createElementSelector,
    createSectionContainerSelector,
    getNativeStyleStatePseudoClass,
    normalizeConfiguredStyleStates,
    PARENT_STYLE_STATE_PREFIX,
} from '@/_common/helpers/styleCompiler';
import { getContentPropertyStateSupport } from '@/_common/helpers/styleCompiler/propertyCapabilities';
import type {
    StyleBreakpointName,
    StyleClassReader,
    StyleCompileScope,
    StyleComponentCapabilities,
    StyleCssFactory,
    StyleElementReader,
    StyleInheritanceCapability,
    StyleLibraryComponentReader,
    StyleParentStateDescriptor,
    StylePropertyDomain,
    StylePropertyTreeReader,
    StyleReader,
    StyleSectionReader,
    StyleStateDescriptor,
    StyleStateReader,
} from '@/_common/helpers/styleCompiler';

const BASE_STATE = 'base';
const DEFAULT_STATE = 'default';
const BREAKPOINT_NAMES: StyleBreakpointName[] = ['default', 'tablet', 'mobile'];
const inheritedConfigurations = new WeakMap<object, StyleSourceData>();
const emptyConfiguration: StyleSourceData = {};

type StyleSourceData = Record<string, any>;
type EditorLibraryComponentSourceIndex = {
    elementUids: string[];
    childLibraryComponentIds: string[];
};
type EditorStyleSourceOwnership = {
    uid: string;
    parentSectionId: string | null;
    parentLibraryComponentId: string | null;
    libraryComponentBaseId: string | null;
    componentBaseId: string | null;
};
type EditorStyleSourceIndex = {
    ownershipByUid: Map<string, EditorStyleSourceOwnership>;
    popupOwnershipByUid: Map<string, EditorStyleSourceOwnership>;
    previewElementUids: string[];
    elementUidsBySectionId: Map<string, string[]>;
    popupInstanceUids: string[];
    libraryComponentsById: Map<string, EditorLibraryComponentSourceIndex>;
    sectionUids: string[];
};
type EditorStyleSourceIndexAccessor = () => EditorStyleSourceIndex;
type EditorParentStateReference = { uid: string; stateId: string };
type EditorParentStateReferenceResolver = (id: string) => EditorParentStateReference | null;

/**
 * Creates the reactive editor scope and reader over one shared source index.
 */
export function createEditorStyleCompilerSources() {
    const sourceIndex = computed<EditorStyleSourceIndex>(previous => createEditorStyleSourceIndex(previous));

    return {
        scope: computed<StyleCompileScope>(previous =>
            reuseUnchangedCompileScope(previous, createEditorStyleCompileScope(sourceIndex.value))
        ),
        reader: createEditorStyleReader(() => sourceIndex.value, parseParentStateReference),
    };
}

function createEditorStyleSourceIndex(previous?: EditorStyleSourceIndex): EditorStyleSourceIndex {
    const wwObjectsByUid = getWwObjects();
    const popupInstancesByUid = wwLib.store.popups.instances || {};
    const previewElementUids = wwLib.store.websiteData.wwObjectPreviewUids || [];
    const sections = getSections();
    const wwObjectUids = Object.keys(wwObjectsByUid);
    const popupInstanceUids = Object.keys(popupInstancesByUid);
    const sectionUids = Object.keys(sections);

    // History synchronization replaces complete reactive source objects even when their ownership
    // is unchanged. Preserve the structural index in that common case so the compiler only wakes
    // the changed target instead of reconciling every target on the active page.
    if (
        previous &&
        sourceOwnershipIsUnchanged(previous.ownershipByUid, wwObjectsByUid, wwObjectUids) &&
        sourceOwnershipIsUnchanged(previous.popupOwnershipByUid, popupInstancesByUid, popupInstanceUids) &&
        stringArraysAreEqual(previous.previewElementUids, previewElementUids) &&
        stringArraysAreEqual(previous.sectionUids, sectionUids)
    ) {
        return previous;
    }

    const ownershipByUid = createSourceOwnershipMap(wwObjectsByUid, wwObjectUids);
    const popupOwnershipByUid = createSourceOwnershipMap(popupInstancesByUid, popupInstanceUids);
    const elementUidsBySectionId = new Map<string, string[]>();
    const libraryComponentsById = new Map<string, EditorLibraryComponentSourceIndex>();

    for (const ownership of ownershipByUid.values()) {
        if (ownership.parentSectionId) {
            const elementUids = elementUidsBySectionId.get(ownership.parentSectionId) || [];
            elementUids.push(ownership.uid);
            elementUidsBySectionId.set(ownership.parentSectionId, elementUids);
        }

        if (!ownership.parentLibraryComponentId) continue;

        const libraryComponent = libraryComponentsById.get(ownership.parentLibraryComponentId) || {
            elementUids: [],
            childLibraryComponentIds: [],
        };
        libraryComponent.elementUids.push(ownership.uid);
        libraryComponentsById.set(ownership.parentLibraryComponentId, libraryComponent);

        if (!ownership.libraryComponentBaseId) continue;

        if (!libraryComponent.childLibraryComponentIds.includes(ownership.libraryComponentBaseId)) {
            libraryComponent.childLibraryComponentIds.push(ownership.libraryComponentBaseId);
        }
    }

    return {
        ownershipByUid,
        popupOwnershipByUid,
        previewElementUids: [...previewElementUids],
        elementUidsBySectionId,
        popupInstanceUids: [...popupOwnershipByUid.keys()],
        libraryComponentsById,
        sectionUids,
    };
}

function createSourceOwnershipMap(sources: Record<string, StyleSourceData>, uids: string[]) {
    return new Map(uids.map(uid => [uid, createSourceOwnership(uid, sources[uid])]));
}

function createSourceOwnership(uid: string, source: StyleSourceData): EditorStyleSourceOwnership {
    return {
        uid: source.uid || uid,
        parentSectionId: source.parentSectionId || null,
        parentLibraryComponentId: source.parentLibraryComponentId || null,
        libraryComponentBaseId: source.libraryComponentBaseId || null,
        componentBaseId: source.wwObjectBaseId || source.libraryComponentBaseId || null,
    };
}

function sourceOwnershipIsUnchanged(
    previous: Map<string, EditorStyleSourceOwnership>,
    sources: Record<string, StyleSourceData>,
    uids: string[]
) {
    if (previous.size !== uids.length) return false;

    const previousUids = previous.keys();
    for (const uid of uids) {
        if (previousUids.next().value !== uid) return false;

        const oldOwnership = previous.get(uid);
        if (!oldOwnership) return false;
        const source = sources[uid];

        if (
            oldOwnership.uid !== (source.uid || uid) ||
            oldOwnership.parentSectionId !== (source.parentSectionId || null) ||
            oldOwnership.parentLibraryComponentId !== (source.parentLibraryComponentId || null) ||
            oldOwnership.libraryComponentBaseId !== (source.libraryComponentBaseId || null) ||
            oldOwnership.componentBaseId !== (source.wwObjectBaseId || source.libraryComponentBaseId || null)
        ) {
            return false;
        }
    }

    return true;
}

/**
 * Creates the editor reader used by the shared compiler.
 */
function createEditorStyleReader(
    getSourceIndex: EditorStyleSourceIndexAccessor,
    resolveParentStateReference: EditorParentStateReferenceResolver
): StyleReader {
    return {
        element(uid) {
            const data = getElementData(uid);
            if (!data) return null;

            return createSourceReader(data, 'element', resolveParentStateReference);
        },
        section(uid) {
            const data = getSections()[uid];
            if (!data) return null;

            return createSourceReader(data, 'section', resolveParentStateReference);
        },
        libraryComponent(id) {
            return createLibraryComponentReader(id, getSourceIndex);
        },
        styleClass(id) {
            const data = getClasses()[id];
            if (!data) return null;

            return createClassReader(data);
        },
    };
}

/**
 * Creates the current page compile scope from store ownership fields.
 */
function createEditorStyleCompileScope(sourceIndex: EditorStyleSourceIndex): StyleCompileScope {
    const page = wwLib.store.websiteData.page;
    const pageSectionUids = (page?.sections || []).map((section: { uid: string }) => section.uid).filter(Boolean);
    const componentBasesStore = wwLib.store.componentBases;
    const sections = getSections();
    const { elementUidsBySectionId, popupInstanceUids, previewElementUids, libraryComponentsById } = sourceIndex;
    const pageElementUids = pageSectionUids.flatMap(uid => elementUidsBySectionId.get(uid) || []);
    const previewRootElementUids = previewElementUids.filter(
        uid => !sourceIndex.ownershipByUid.get(uid)?.parentLibraryComponentId
    );
    const previewLibraryElementUids = previewElementUids.filter(
        uid => !!sourceIndex.ownershipByUid.get(uid)?.parentLibraryComponentId
    );
    const rootElementUids = uniqueStrings([...pageElementUids, ...popupInstanceUids, ...previewRootElementUids]);
    const { elementUids: libraryElementUids, libraryComponentIds } = collectDeepLibraryComponentElements(
        libraryComponentsById,
        rootElementUids
    );
    const readyRootElementUids = rootElementUids.filter(uid =>
        isElementStyleSourceReady(getElementData(uid), componentBasesStore)
    );
    const readyLibraryElementUids = uniqueStrings([...libraryElementUids, ...previewLibraryElementUids]).filter(uid =>
        isElementStyleSourceReady(getElementData(uid), componentBasesStore)
    );

    return {
        sectionUids: pageSectionUids.filter(uid => isSectionStyleSourceReady(sections[uid], componentBasesStore)),
        elementUids: readyRootElementUids,
        libraryElementUids: readyLibraryElementUids,
        libraryComponentIds: libraryComponentIds.filter(libraryComponentId =>
            isLibraryComponentStyleSourceReady(libraryComponentId, componentBasesStore)
        ),
    };
}

function reuseUnchangedCompileScope(previous: StyleCompileScope | undefined, next: StyleCompileScope) {
    if (!previous) return next;
    if (!stringArraysAreEqual(previous.sectionUids, next.sectionUids)) return next;
    if (!stringArraysAreEqual(previous.elementUids, next.elementUids)) return next;
    if (!stringArraysAreEqual(previous.libraryElementUids || [], next.libraryElementUids || [])) return next;
    if (!stringArraysAreEqual(previous.libraryComponentIds || [], next.libraryComponentIds || [])) return next;

    return previous;
}

function stringArraysAreEqual(left: readonly string[], right: readonly string[]) {
    return left.length === right.length && left.every((value, index) => value === right[index]);
}

function createSourceReader(
    data: StyleSourceData,
    kind: 'element',
    resolveParentStateReference: EditorParentStateReferenceResolver
): StyleElementReader;
function createSourceReader(
    data: StyleSourceData,
    kind: 'section',
    resolveParentStateReference: EditorParentStateReferenceResolver
): StyleSectionReader;
function createSourceReader(
    data: StyleSourceData,
    kind: 'element' | 'section',
    resolveParentStateReference: EditorParentStateReferenceResolver
): StyleElementReader | StyleSectionReader {
    if (kind === 'element') {
        return {
            ...createBaseSourceReader(data, kind, resolveParentStateReference),
            kind() {
                return 'element' as const;
            },
            isLibraryComponentInstance() {
                return isLibraryComponentInstance(data);
            },
            effectiveFallbackSource() {
                if (!isLibraryComponentInstance(data)) return null;

                const fallbackData = getLibraryComponentRootElement(data.libraryComponentBaseId);
                return fallbackData ? createSourceReader(fallbackData, 'element', resolveParentStateReference) : null;
            },
            isDirectSectionChild() {
                return isDirectSectionChild(data);
            },
        };
    }

    return {
        ...createBaseSourceReader(data, kind, resolveParentStateReference),
        kind() {
            return 'section' as const;
        },
    };
}

function createBaseSourceReader(
    data: StyleSourceData,
    kind: 'element' | 'section',
    resolveParentStateReference: EditorParentStateReferenceResolver
) {
    return {
        uid() {
            return data.uid;
        },
        styleSourceId() {
            return typeof data._si === 'number' ? data._si : undefined;
        },
        baseId() {
            return getSourceBaseId(data, kind);
        },
        capabilities() {
            return createSourceCapabilities(data, kind);
        },
        states() {
            return getSourceStates(data, kind, resolveParentStateReference);
        },
        emitDefaultDeclarations() {
            return shouldEmitSourceDefaultDeclarations(data, kind);
        },
        parentRef() {
            return getSourceParentRef(data, kind);
        },
        style() {
            return createPropertyTreeReader(data, 'style');
        },
        content() {
            const configuration = getSourceConfiguration(data, kind);
            return createPropertyTreeReader(
                data,
                'content',
                getContentPropertyStateSupport(configuration, getInheritedSourceConfiguration(configuration))
            );
        },
    };
}

function createSourceCapabilities(data: StyleSourceData, kind: 'element' | 'section'): StyleComponentCapabilities {
    const configuration = getSourceConfiguration(data, kind);
    const inherits = normalizeInheritedCapabilities(configuration?.inherit);
    const baseId = getSourceBaseId(data, kind);

    return {
        inherits,
        autoByContent: !!configuration?.options?.autoByContent,
        displayAllowedValues: getSourceDisplayAllowedValues(configuration, data),
        omitUndefinedDynamicValues: kind === 'element' && isLibraryComponentInstance(data),
        ignoredStyleProperties: getStringArray(configuration?.options?.ignoredStyleProperties),
        css: createSourceCssFactories({
            configuration,
            inherits,
            kind,
            baseId,
        }),
    };
}

function getSourceConfiguration(data: StyleSourceData, kind: 'element' | 'section') {
    const baseId = getSourceBaseId(data, kind);
    if (!baseId) return emptyConfiguration;

    if (kind === 'section') return getComponentBaseConfiguration('section', baseId);
    if (data.libraryComponentBaseId && !data.wwObjectBaseId) {
        return getComponentBaseConfiguration('libraryComponent', baseId);
    }

    return getComponentBaseConfiguration('element', baseId);
}

function getInheritedSourceConfiguration(configuration: StyleSourceData): StyleSourceData {
    const cached = inheritedConfigurations.get(configuration);
    if (cached) return cached;

    const resolved = getInheritedConfiguration({ inherit: configuration.inherit });
    inheritedConfigurations.set(configuration, resolved);
    return resolved;
}

function getSourceBaseId(data: StyleSourceData, kind: 'element' | 'section') {
    return kind === 'section' ? data.sectionBaseId : data.wwObjectBaseId || data.libraryComponentBaseId;
}

function createSourceCssFactories({
    configuration,
    inherits,
    kind,
    baseId,
}: {
    configuration: StyleSourceData;
    inherits: readonly StyleInheritanceCapability[];
    kind: 'element' | 'section';
    baseId: string | undefined;
}) {
    const cssFactories: StyleCssFactory[] = [];

    if (
        kind === 'element' &&
        baseId !== 'ww-text' &&
        inherits.some(inheritance => getInheritanceType(inheritance) === 'ww-text')
    ) {
        const inheritedTextCss = getComponentBaseConfiguration('element', 'ww-text')?.css;
        if (typeof inheritedTextCss === 'function') cssFactories.push(inheritedTextCss);
    }

    if (typeof configuration?.css === 'function') cssFactories.push(configuration.css);

    return cssFactories.length ? cssFactories : undefined;
}

function getInheritanceType(inheritance: StyleInheritanceCapability) {
    return typeof inheritance === 'string' ? inheritance : inheritance.type;
}

function shouldEmitSourceDefaultDeclarations(data: StyleSourceData, kind: 'element' | 'section') {
    if (kind !== 'element') return true;

    return !isLibraryComponentInstance(data);
}

function isLibraryComponentInstance(data: StyleSourceData) {
    return !!data.libraryComponentBaseId && !data.wwObjectBaseId;
}

function getSourceDisplayAllowedValues(configuration: StyleSourceData, data: StyleSourceData) {
    const rootSource = isLibraryComponentInstance(data)
        ? getConcreteLibraryComponentRootSource(data.libraryComponentBaseId)
        : null;
    const displayConfiguration = rootSource?.configuration || configuration;
    const displayData = rootSource?.data || data;
    const displayAllowedValues = getConfigurationDisplayAllowedValues(displayConfiguration, {
        content: getDefaultContentSlot(displayData),
        wwProps: {},
    });

    return Array.isArray(displayAllowedValues) ? displayAllowedValues : undefined;
}

/**
 * Resolves the concrete element rendered by a library component instance.
 *
 * The legacy inline engine merged instance style values into the concrete root before normalizing
 * them. Following nested renderless library roots preserves that behavior for values such as
 * `display: true`, which means "use the concrete component's default display".
 */
function getConcreteLibraryComponentRootSource(
    libraryComponentId: string,
    visitedLibraryComponentIds = new Set<string>()
): { configuration: StyleSourceData; data: StyleSourceData } | null {
    if (!libraryComponentId || visitedLibraryComponentIds.has(libraryComponentId)) return null;

    visitedLibraryComponentIds.add(libraryComponentId);

    const rootElement = getLibraryComponentRootElement(libraryComponentId);
    if (!rootElement) return null;

    if (rootElement.wwObjectBaseId) {
        return {
            configuration: getComponentBaseConfiguration('element', rootElement.wwObjectBaseId) || {},
            data: rootElement,
        };
    }

    if (!isLibraryComponentInstance(rootElement)) return null;

    return getConcreteLibraryComponentRootSource(rootElement.libraryComponentBaseId, visitedLibraryComponentIds);
}

function getLibraryComponentRootElement(libraryComponentId: string): StyleSourceData | null {
    const rootElementUid = getLibraryComponents()[libraryComponentId]?.rootElementId;
    return rootElementUid ? getElementData(rootElementUid) || null : null;
}

function getDefaultContentSlot(data: StyleSourceData) {
    return data.content?.default || {};
}

function getSourceParentRef(data: StyleSourceData, kind: 'element' | 'section') {
    if (kind !== 'element') return null;

    const sectionUid = data.parentSectionId;
    const section = getSections()[sectionUid];
    if (!sectionUid || !section) return null;

    return {
        uid: sectionUid,
        styleSourceId: section._si,
        selector: createSectionContainerSelector(sectionUid, section._si),
    };
}

function isDirectSectionChild(data: StyleSourceData) {
    const sectionUid = data.parentSectionId;
    if (!sectionUid) return false;

    const sectionRootElements = getSections()[sectionUid]?.content?.default?.wwObjects;
    if (!Array.isArray(sectionRootElements)) return false;

    return sectionRootElements.some(element => element?.uid === data.uid);
}

function normalizeInheritedCapabilities(value: unknown): StyleInheritanceCapability[] {
    if (Array.isArray(value)) {
        return value.flatMap(item => normalizeInheritedCapabilities(item));
    }

    if (typeof value === 'string') return [value];
    if (!isPlainRecord(value) || typeof value.type !== 'string') return [];

    const exclude = getStringArray(value.exclude);
    return exclude.length ? [{ type: value.type, exclude }] : [{ type: value.type }];
}

function createLibraryComponentReader(
    id: string,
    getSourceIndex: EditorStyleSourceIndexAccessor
): StyleLibraryComponentReader | null {
    const component = wwLib.store.libraries.components[id];
    if (!component) return null;

    return {
        rootElementUid() {
            return component.rootElementId;
        },
        childLibraryComponentIds() {
            return getSourceIndex().libraryComponentsById.get(id)?.childLibraryComponentIds || [];
        },
    };
}

function createClassReader(data: StyleSourceData): StyleClassReader {
    return {
        style() {
            return createPropertyTreeReader(data, 'style');
        },
        content() {
            return createPropertyTreeReader(data, 'content');
        },
        subClass(id) {
            const subClass = data.subClasses?.[id];
            return subClass ? createClassReader(subClass) : null;
        },
    };
}

function createPropertyTreeReader(
    data: StyleSourceData,
    domain: StylePropertyDomain,
    supportsState?: (property: string) => boolean
): StylePropertyTreeReader {
    return {
        ...(supportsState ? { supportsState } : {}),
        state(name) {
            return createStateReader(data, domain, name);
        },
    };
}

function createStateReader(data: StyleSourceData, domain: StylePropertyDomain, state: string): StyleStateReader {
    return {
        classIds() {
            return getStringArray(data._state?.classes?.[toStorageState(state)]);
        },
        subClassIds(classId) {
            return getStringArray(data._state?.subClasses?.[toStorageState(state)]?.[classId]);
        },
        breakpoint(name) {
            return {
                property(propertyName) {
                    return getPropertySlot(data, domain, state, name)?.[propertyName];
                },
                customCss() {
                    return getPropertySlot(data, domain, state, name)?.customCss;
                },
                customCssProperty(propertyName) {
                    return getPropertySlot(data, domain, state, name)?.customCss?.[propertyName];
                },
                customCssEntries() {
                    const customCss = getPropertySlot(data, domain, state, name)?.customCss;
                    if (
                        !customCss ||
                        typeof customCss !== 'object' ||
                        Array.isArray(customCss) ||
                        '__wwtype' in customCss
                    ) {
                        return [];
                    }

                    return Object.entries(customCss);
                },
            };
        },
    };
}

function getPropertySlot(
    data: StyleSourceData,
    domain: StylePropertyDomain,
    state: string,
    breakpoint: StyleBreakpointName
) {
    const slotKey = createSlotKey(state, breakpoint);
    return domain === 'style' ? data._state?.style?.[slotKey] : data.content?.[slotKey];
}

function createSlotKey(state: string, breakpoint: StyleBreakpointName) {
    const storageState = toStorageState(state);
    if (storageState === DEFAULT_STATE) return breakpoint;

    return `${storageState}_${breakpoint}`;
}

function toStorageState(state: string) {
    return state === BASE_STATE ? DEFAULT_STATE : state;
}

function getSourceStates(
    data: StyleSourceData,
    kind: 'element' | 'section',
    resolveParentStateReference: EditorParentStateReferenceResolver
) {
    const states = new Map<string, StyleStateDescriptor>();
    const selectorsByLabel = getConfiguredSelectorsByStateLabel(data, kind);

    for (const state of data._state?.states || []) {
        if (!state?.id) continue;

        const label = typeof state.label === 'string' ? state.label : undefined;
        const descriptor = createStateDescriptor(state.id, selectorsByLabel, resolveParentStateReference, label);
        if (!hasAvailableParentState(state.id, descriptor)) continue;

        states.set(state.id, descriptor);
    }

    collectStateNamesFromSlotKeys(
        states,
        Object.keys(data._state?.style || {}),
        selectorsByLabel,
        resolveParentStateReference
    );
    collectStateNamesFromSlotKeys(
        states,
        Object.keys(data.content || {}),
        selectorsByLabel,
        resolveParentStateReference
    );
    collectStateNamesFromClassKeys(
        states,
        Object.keys(data._state?.classes || {}),
        selectorsByLabel,
        resolveParentStateReference
    );
    collectStateNamesFromClassKeys(
        states,
        Object.keys(data._state?.subClasses || {}),
        selectorsByLabel,
        resolveParentStateReference
    );

    states.delete(BASE_STATE);
    states.delete(DEFAULT_STATE);
    return [...states.values()];
}

function getConfiguredSelectorsByStateLabel(data: StyleSourceData, kind: 'element' | 'section') {
    const selectorsByLabel = new Map<string, readonly string[]>();
    const configuration = getSourceConfiguration(data, kind);

    for (const state of normalizeConfiguredStyleStates(configuration?.states)) {
        if (state.selectors?.length) selectorsByLabel.set(state.label, state.selectors);
    }

    return selectorsByLabel;
}

function collectStateNamesFromSlotKeys(
    states: Map<string, StyleStateDescriptor>,
    keys: string[],
    selectorsByLabel: Map<string, readonly string[]>,
    resolveParentStateReference: EditorParentStateReferenceResolver
) {
    for (const key of keys) {
        for (const breakpoint of BREAKPOINT_NAMES) {
            const suffix = `_${breakpoint}`;
            if (!key.endsWith(suffix)) continue;

            const state = key.slice(0, -suffix.length);
            const descriptor = createInferredStateDescriptor(
                states,
                state,
                selectorsByLabel,
                resolveParentStateReference
            );
            if (!descriptor) continue;

            states.set(state, descriptor);
        }
    }
}

function collectStateNamesFromClassKeys(
    states: Map<string, StyleStateDescriptor>,
    keys: string[],
    selectorsByLabel: Map<string, readonly string[]>,
    resolveParentStateReference: EditorParentStateReferenceResolver
) {
    for (const key of keys) {
        const descriptor = createInferredStateDescriptor(states, key, selectorsByLabel, resolveParentStateReference);
        if (!descriptor) continue;

        states.set(key, descriptor);
    }
}

function createInferredStateDescriptor(
    states: Map<string, StyleStateDescriptor>,
    state: string,
    selectorsByLabel: Map<string, readonly string[]>,
    resolveParentStateReference: EditorParentStateReferenceResolver
): StyleStateDescriptor | null {
    if (!state || state === DEFAULT_STATE || state === BASE_STATE || states.has(state)) return null;

    const descriptor = createStateDescriptor(state, selectorsByLabel, resolveParentStateReference);
    if (!hasAvailableParentState(state, descriptor)) return null;

    return hasIndependentlyMatchingStateSelector(descriptor) ? null : descriptor;
}

function hasIndependentlyMatchingStateSelector(descriptor: StyleStateDescriptor) {
    // Runtime-only inferred states remain inert without `_state.states`. Native and configured
    // selectors can match the DOM independently, so inferring them would resurrect orphaned styles.
    if (getNativeStyleStatePseudoClass(descriptor.id) || descriptor.selectors?.length) return true;

    return !!(
        descriptor.parent &&
        (getNativeStyleStatePseudoClass(descriptor.parent.stateId) || descriptor.parent.selectors?.length)
    );
}

function hasAvailableParentState(id: string, descriptor: StyleStateDescriptor) {
    if (!id.startsWith(PARENT_STYLE_STATE_PREFIX)) return true;
    if (!descriptor.parent) return false;

    const parentSource = getParentStateSource(descriptor.parent.uid);
    return !!parentSource && hasSourceStateId(parentSource.data, descriptor.parent.stateId);
}

function createStateDescriptor(
    id: string,
    selectorsByLabel: Map<string, readonly string[]>,
    resolveParentStateReference: EditorParentStateReferenceResolver,
    label?: string
): StyleStateDescriptor {
    const parent = createParentStateDescriptor(id, resolveParentStateReference);
    if (parent) return { id, parent };

    const stateLabel = label || id;
    const selectors = selectorsByLabel.get(stateLabel);

    return selectors ? { id, label: stateLabel, selectors } : { id, label };
}

function createParentStateDescriptor(
    id: string,
    resolveParentStateReference: EditorParentStateReferenceResolver
): StyleParentStateDescriptor | null {
    const parentStateReference = resolveParentStateReference(id);
    if (!parentStateReference) return null;

    const parentSource = getParentStateSource(parentStateReference.uid);
    if (!parentSource) {
        return {
            uid: parentStateReference.uid,
            stateId: parentStateReference.stateId,
        };
    }

    const parentState = findSourceState(parentSource.data, parentStateReference.stateId);
    const parentStateLabel = getSourceStateLabel(parentState, parentStateReference.stateId);
    const parentSelectors = getConfiguredSelectorsByStateLabel(parentSource.data, parentSource.kind).get(
        parentStateLabel
    );

    return {
        uid: parentStateReference.uid,
        stateId: parentStateReference.stateId,
        selector: parentSource.selector,
        selectors: parentSelectors,
    };
}

function parseParentStateReference(id: string): EditorParentStateReference | null {
    if (!id.startsWith(PARENT_STYLE_STATE_PREFIX)) return null;

    const payload = id.slice(PARENT_STYLE_STATE_PREFIX.length);
    let separatorIndex = payload.lastIndexOf('_');
    while (separatorIndex > 0) {
        const uid = payload.slice(0, separatorIndex);
        if (getParentStateSource(uid)) {
            const stateId = payload.slice(separatorIndex + 1);
            return stateId ? { uid, stateId } : null;
        }

        separatorIndex = payload.lastIndexOf('_', separatorIndex - 1);
    }

    return null;
}

function getParentStateSource(uid: string) {
    const element = getElementData(uid);
    if (element) {
        return {
            data: element,
            kind: 'element' as const,
            selector: createElementSelector(uid, element._si),
        };
    }

    const section = getSections()[uid];
    if (section) {
        return {
            data: section,
            kind: 'section' as const,
            selector: createSectionContainerSelector(uid, section._si),
        };
    }

    return null;
}

function findSourceState(data: StyleSourceData, stateId: string) {
    return (data._state?.states || []).find(
        (state: StyleSourceData) => state?.id === stateId || state?.label === stateId
    );
}

function hasSourceStateId(data: StyleSourceData, stateId: string) {
    return (data._state?.states || []).some((state: StyleSourceData) => state?.id === stateId);
}

function getSourceStateLabel(state: StyleSourceData | undefined, fallback: string) {
    return typeof state?.label === 'string' ? state.label : fallback;
}

function collectDeepLibraryComponentElements(
    libraryComponentsById: Map<string, EditorLibraryComponentSourceIndex>,
    rootElementUids: string[]
) {
    const elementUids: string[] = [];
    const seenElementUids = new Set<string>();
    const pendingLibraryIds = uniqueStrings(rootElementUids.map(uid => getElementData(uid)?.libraryComponentBaseId));
    const seenLibraryIds = new Set<string>();

    while (pendingLibraryIds.length) {
        const libraryComponentId = pendingLibraryIds.shift();
        if (!libraryComponentId || seenLibraryIds.has(libraryComponentId)) continue;

        seenLibraryIds.add(libraryComponentId);

        const libraryComponent = libraryComponentsById.get(libraryComponentId);
        for (const elementUid of libraryComponent?.elementUids || []) {
            if (seenElementUids.has(elementUid)) continue;

            seenElementUids.add(elementUid);
            elementUids.push(elementUid);
        }

        pendingLibraryIds.push(...(libraryComponent?.childLibraryComponentIds || []));
    }

    return { elementUids, libraryComponentIds: [...seenLibraryIds] };
}

function getWwObjects(): Record<string, StyleSourceData> {
    return wwLib.store.websiteData.wwObjects || {};
}

function getElementData(uid: string): StyleSourceData | undefined {
    return getWwObjects()[uid] || wwLib.store.popups.instances?.[uid];
}

function getSections(): Record<string, StyleSourceData> {
    return wwLib.store.websiteData.sections || {};
}

function getClasses(): Record<string, StyleSourceData> {
    return wwLib.store.libraries.classes || {};
}

function getLibraryComponents(): Record<string, StyleSourceData> {
    return wwLib.store.libraries.components || {};
}

function isSectionStyleSourceReady(
    data: StyleSourceData | undefined,
    componentBasesStore: StoreRegistry['componentBases']
) {
    if (!data) return false;

    return isRegisteredComponentBaseReady('section', data.sectionBaseId, componentBasesStore);
}

function isElementStyleSourceReady(
    data: StyleSourceData | undefined,
    componentBasesStore: StoreRegistry['componentBases']
) {
    if (!data) return false;
    if (!data.wwObjectBaseId) return true;

    return isRegisteredComponentBaseReady('wwobject', data.wwObjectBaseId, componentBasesStore);
}

function isLibraryComponentStyleSourceReady(
    libraryComponentId: string,
    componentBasesStore: StoreRegistry['componentBases']
) {
    const rootElementUid = getLibraryComponents()[libraryComponentId]?.rootElementId;
    if (!rootElementUid) return true;

    return isElementStyleSourceReady(getElementData(rootElementUid), componentBasesStore);
}

function isRegisteredComponentBaseReady(
    type: 'section' | 'wwobject',
    baseId: string | undefined,
    componentBasesStore: StoreRegistry['componentBases']
) {
    if (!baseId) return true;

    return !!componentBasesStore.configurations[`${type}-${baseId}`];
}

function getStringArray(value: unknown) {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function uniqueStrings(values: unknown[]) {
    return [...new Set(values.filter((value): value is string => typeof value === 'string' && !!value))];
}

function isPlainRecord(value: unknown): value is Record<string, any> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}
