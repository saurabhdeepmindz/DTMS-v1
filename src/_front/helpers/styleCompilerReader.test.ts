import type { Registry, ComponentDefinition, LibraryComponent } from '@/pinia/entities';
import { withStoreRegistry } from '@/pinia/testRegistry.test-support';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, nextTick, reactive, watchEffect } from 'vue';

import {
    createElementSelector,
    createStringStyleSheetAdapter,
    createStyleCompiler,
    STATIC_STYLE_RUNTIME,
} from '@/_common/helpers/styleCompiler';
import {
    BACKGROUND_VIDEO_CONFIGURATION,
    GRID_CONFIGURATION,
    LAYOUT_CONFIGURATION,
    TEXT_CONFIGURATION,
} from '@/_common/helpers/configuration/configurationInherit';
import { getInheritedConfiguration } from '@/_common/helpers/configuration/configuration';
import { getContentPropertyStateSupport } from '@/_common/helpers/styleCompiler/propertyCapabilities';
import { createReactiveCompileScope } from './styleCompilerRuntimeScope';
import { createEditorStyleCompilerSources } from './styleCompilerReader';

const componentConfigurations = vi.hoisted(
    () =>
        new Map<
            string,
            {
                inherit?: unknown;
                states?: Array<string | { label: string; selectors?: string[] }>;
                options?: { autoByContent?: boolean; displayAllowedValues?: string[] };
                properties?: Record<string, { states?: boolean }>;
            }
        >()
);
const popupStore = vi.hoisted(() => ({ instances: {} as Record<string, StyleSourceData> }));

vi.mock('@/_common/helpers/component/component', () => ({
    getComponentBaseConfiguration: vi.fn((type: string, baseId: string) =>
        componentConfigurations.get(`${type}:${baseId}`)
    ),
    getDisplayAllowedValues: vi.fn(
        (configuration?: { options?: { displayAllowedValues?: string[] } }) =>
            configuration?.options?.displayAllowedValues || ['block', 'inline-block']
    ),
}));

vi.mock('@/pinia/popup', () => ({
    usePopupStore: vi.fn(() => popupStore),
}));

vi.mock('@/pinia/componentBases', () => ({
    useComponentBasesStore: vi.fn(() => ({ configurations: {} })),
}));

type StyleSourceData = {
    uid?: string;
    _si?: number;
    rootElementId?: string;
    wwObjectBaseId?: string | null;
    libraryComponentBaseId?: string | null;
    parentLibraryComponentId?: string | null;
    parentSectionId?: string | null;
    _state?: Record<string, unknown>;
    content?: Record<string, unknown>;
};

let elements: Record<string, StyleSourceData>;
let sections: Record<string, StyleSourceData>;
let libraryComponents: Record<string, StyleSourceData>;
let previewElementUids: string[];

beforeEach(() => {
    componentConfigurations.clear();
    componentConfigurations.set('libraryComponent:libraryA', {});
    componentConfigurations.set('libraryComponent:libraryB', {});
    componentConfigurations.set('element:flexRootBase', {
        inherit: [{ type: 'ww-layout' }],
        options: { displayAllowedValues: ['flex', 'inline-flex'] },
    });
    componentConfigurations.set('element:gridRootBase', {
        inherit: [{ type: 'ww-layout' }],
        options: { displayAllowedValues: ['grid', 'inline-grid'] },
    });

    elements = reactive<Record<string, StyleSourceData>>({});
    sections = reactive<Record<string, StyleSourceData>>({});
    libraryComponents = reactive<Record<string, StyleSourceData>>({});
    popupStore.instances = reactive<Record<string, StyleSourceData>>({});
    previewElementUids = reactive<string[]>([]);

    const runtime = withStoreRegistry({});
    runtime.store.websiteData.wwObjects = elements as Registry<ComponentDefinition>;
    runtime.store.websiteData.sections = sections as Registry<ComponentDefinition>;
    runtime.store.websiteData.wwObjectPreviewUids = previewElementUids;
    runtime.store.websiteData.pageId = 'page';
    runtime.store.websiteData.design.pages = [{ id: 'page', sections: [{ uid: 'sectionA' }] }];
    runtime.store.libraries.components = libraryComponents as Registry<LibraryComponent>;
});

describe('styleCompilerReader source indexing', () => {
    it('keeps the compile scope stable for an Arkero-sized non-structural update', async () => {
        const activePageElementCount = 1_978;
        const projectElementCount = 4_081;

        for (let index = 0; index < projectElementCount; index += 1) {
            const uid = `element${index}`;
            elements[uid] = {
                uid,
                parentSectionId: index < activePageElementCount ? 'sectionA' : 'sectionB',
                _state: { style: { default: { width: `${index}px` } } },
            };
        }

        const sources = createEditorStyleCompilerSources();
        const observedScopes: unknown[] = [];
        const stop = watchEffect(() => observedScopes.push(sources.scope.value));

        expect(sources.scope.value.elementUids).toHaveLength(activePageElementCount);
        expect(observedScopes).toHaveLength(1);

        elements.element0 = {
            ...elements.element0,
            _state: { style: { default: { width: '240px' } } },
        };
        await nextTick();

        expect(observedScopes).toHaveLength(1);

        elements.element0 = { ...elements.element0, parentSectionId: 'sectionB' };
        await nextTick();

        expect(observedScopes).toHaveLength(2);
        expect(sources.scope.value.elementUids).toHaveLength(activePageElementCount - 1);
        stop();
    });

    it('does not rescan every element for each nested library component and parent state', () => {
        let fullObjectScans = 0;
        elements = reactive(
            new Proxy<Record<string, StyleSourceData>>(
                {},
                {
                    ownKeys(target) {
                        fullObjectScans += 1;
                        return Reflect.ownKeys(target);
                    },
                }
            )
        );

        wwLib.store.websiteData.wwObjects = elements as Registry<ComponentDefinition>;
        const libraryComponentCount = 40;
        elements.pageRoot = {
            uid: 'pageRoot',
            libraryComponentBaseId: 'library0',
            parentSectionId: 'sectionA',
        };

        for (let index = 0; index < libraryComponentCount; index += 1) {
            const libraryComponentId = `library${index}`;
            const childLibraryComponentId = index + 1 < libraryComponentCount ? `library${index + 1}` : null;
            const elementUid = `libraryElement${index}`;

            elements[elementUid] = {
                uid: elementUid,
                libraryComponentBaseId: childLibraryComponentId,
                parentLibraryComponentId: libraryComponentId,
                _state: {
                    style: {
                        [`_wwParent_pageRoot_hover_default`]: { opacity: 0.5 },
                    },
                },
            };
            libraryComponents[libraryComponentId] = { rootElementId: elementUid };
        }

        fullObjectScans = 0;
        Object.values(elements);
        const scanCost = fullObjectScans;
        fullObjectScans = 0;

        const sources = createEditorStyleCompilerSources();

        for (const libraryComponentId of sources.scope.value.libraryComponentIds) {
            sources.reader.libraryComponent(libraryComponentId)?.childLibraryComponentIds?.();
        }
        for (const elementUid of sources.scope.value.libraryElementUids || []) {
            sources.reader.element(elementUid)?.states();
        }

        expect(sources.scope.value.libraryComponentIds).toHaveLength(libraryComponentCount);
        expect(fullObjectScans).toBeLessThanOrEqual(scanCost);
    });

    it('invalidates the shared index when an element is added', () => {
        const sources = createEditorStyleCompilerSources();

        expect(sources.scope.value.elementUids).not.toContain('newElement');

        elements.newElement = { uid: 'newElement', parentSectionId: 'sectionA' };

        expect(sources.scope.value.elementUids).toContain('newElement');
    });

    it('compiles transient drag-preview objects even though they are not attached to a page section', () => {
        const sources = createEditorStyleCompilerSources();
        elements.previewHeading = {
            uid: 'previewHeading',
            _state: { style: { default: { fontSize: '38px' } } },
        };

        expect(sources.scope.value.elementUids).not.toContain('previewHeading');

        previewElementUids.push('previewHeading');

        expect(sources.scope.value.elementUids).toContain('previewHeading');
    });

    it('does not recompile existing targets when an unrelated element is added', async () => {
        for (let index = 0; index < 5; index += 1) {
            const uid = `element${index}`;
            elements[uid] = { uid, parentSectionId: 'sectionA' };
        }

        const sources = createEditorStyleCompilerSources();
        const editorReader = sources.reader;
        let elementReads = 0;
        const reader = {
            ...editorReader,
            element(uid: string) {
                elementReads += 1;
                return editorReader.element(uid);
            },
        };
        const run = createStyleCompiler().compileStylesheet({
            scope: createReactiveCompileScope(sources.scope),
            reader,
            stylesheet: createStringStyleSheetAdapter(),
            runtime: {
                createScope: effectScope,
                effect: callback => watchEffect(callback),
            },
        });

        try {
            await nextTick();
            expect(elementReads).toBe(5);

            elementReads = 0;
            elements.newElement = { uid: 'newElement', parentSectionId: 'sectionA' };
            await nextTick();

            expect(elementReads).toBe(1);
        } finally {
            run.stop();
        }
    });

    it('does not recompile parent-state targets when an unrelated element is added', async () => {
        elements.parent = {
            uid: 'parent',
            parentSectionId: 'sectionA',
            _state: { states: [{ id: 'hover', label: 'Hover' }] },
        };
        elements.child = {
            uid: 'child',
            parentSectionId: 'sectionA',
            _state: {
                style: {
                    _wwParent_parent_hover_default: { opacity: 0.5 },
                },
            },
        };

        const sources = createEditorStyleCompilerSources();
        const editorReader = sources.reader;
        const readsByUid = new Map<string, number>();
        const reader = {
            ...editorReader,
            element(uid: string) {
                readsByUid.set(uid, (readsByUid.get(uid) || 0) + 1);
                return editorReader.element(uid);
            },
        };
        const run = createStyleCompiler().compileStylesheet({
            scope: createReactiveCompileScope(sources.scope),
            reader,
            stylesheet: createStringStyleSheetAdapter(),
            runtime: {
                createScope: effectScope,
                effect: callback => watchEffect(callback),
            },
        });

        try {
            await nextTick();
            readsByUid.clear();
            elements.unrelated = { uid: 'unrelated', parentSectionId: 'sectionA' };
            await nextTick();

            expect([...readsByUid.entries()]).toEqual([['unrelated', 1]]);
        } finally {
            run.stop();
        }
    });

    // This 14,500-element fixture checks invalidation by read counts; initial compilation needs time under suite load.
    it('keeps GoodNow-scale parent-state targets idle during popup and paste mutations', async () => {
        const projectElementCount = 14_500;
        const activePageElementCount = 3_718;
        const parentStateTargetCount = 207;
        const parentStateRuleCount = 250;

        for (let index = 0; index < projectElementCount; index += 1) {
            const uid = `element${index}`;
            elements[uid] = {
                uid,
                parentSectionId: index < activePageElementCount ? 'sectionA' : 'sectionB',
            };
        }
        for (let index = 0; index < parentStateTargetCount; index += 1) {
            const parentUid = `element${parentStateTargetCount + index}`;
            const style = {
                [`_wwParent_${parentUid}_hover_default`]: { opacity: 0.5 },
            };
            const parentStates = [{ id: 'hover', label: 'Hover' }];
            if (index < parentStateRuleCount - parentStateTargetCount) {
                style[`_wwParent_${parentUid}_focus_default`] = { opacity: 0.75 };
                parentStates.push({ id: 'focus', label: 'Focus' });
            }
            elements[`element${index}`]._state = { style };
            elements[parentUid]._state = { states: parentStates };
        }

        const sources = createEditorStyleCompilerSources();
        const editorReader = sources.reader;
        const readsByUid = new Map<string, number>();
        const reader = {
            ...editorReader,
            element(uid: string) {
                readsByUid.set(uid, (readsByUid.get(uid) || 0) + 1);
                return editorReader.element(uid);
            },
        };
        const run = createStyleCompiler().compileStylesheet({
            scope: createReactiveCompileScope(sources.scope),
            reader,
            stylesheet: createStringStyleSheetAdapter(),
            runtime: {
                createScope: effectScope,
                effect: callback => watchEffect(callback),
            },
        });

        try {
            await nextTick();
            readsByUid.clear();

            popupStore.instances.popupInstance = { uid: 'popupInstance' };
            await nextTick();
            expect([...readsByUid.keys()]).toEqual(['popupInstance']);

            readsByUid.clear();
            delete popupStore.instances.popupInstance;
            await nextTick();
            expect(readsByUid.size).toBe(0);

            for (let index = 0; index < 3; index += 1) {
                const uid = `pastedElement${index}`;
                elements[uid] = { uid, parentSectionId: 'sectionA' };
            }
            await nextTick();
            expect([...readsByUid.keys()]).toEqual(['pastedElement0', 'pastedElement1', 'pastedElement2']);
        } finally {
            run.stop();
        }
    }, 15_000);

    it('recompiles only the replaced target when membership is unchanged', async () => {
        for (let index = 0; index < 100; index += 1) {
            const uid = `element${index}`;
            elements[uid] = {
                uid,
                parentSectionId: 'sectionA',
                _state: { style: { default: { width: `${index}px` } } },
            };
        }

        const sources = createEditorStyleCompilerSources();
        const editorReader = sources.reader;
        let elementReads = 0;
        const reader = {
            ...editorReader,
            element(uid: string) {
                elementReads += 1;
                return editorReader.element(uid);
            },
        };
        const run = createStyleCompiler().compileStylesheet({
            scope: createReactiveCompileScope(sources.scope),
            reader,
            stylesheet: createStringStyleSheetAdapter(),
            runtime: {
                createScope: effectScope,
                effect: callback => watchEffect(callback),
            },
        });

        try {
            await nextTick();
            expect(elementReads).toBe(100);

            elementReads = 0;
            elements.element42 = {
                ...elements.element42,
                _state: { style: { default: { width: '240px' } } },
            };
            await nextTick();

            expect(elementReads).toBe(1);
        } finally {
            run.stop();
        }
    });

    it('resolves parent states through the lazy source index', () => {
        elements.parent = {
            uid: 'parent',
            parentSectionId: 'sectionA',
            _state: { states: [{ id: 'hover', label: 'Hover' }] },
        };
        elements.child = {
            uid: 'child',
            parentSectionId: 'sectionA',
            _state: {
                style: {
                    _wwParent_parent_hover_default: { opacity: 0.5 },
                },
            },
        };

        const parentState = createEditorStyleCompilerSources()
            .reader.element('child')
            ?.states()
            .find(state => state.id === '_wwParent_parent_hover');

        expect(parentState?.parent).toMatchObject({
            uid: 'parent',
            stateId: 'hover',
            selector: createElementSelector('parent'),
        });
    });

    it('ignores undeclared native states persisted outside the state list', () => {
        elements.elementA = {
            uid: 'elementA',
            parentSectionId: 'sectionA',
            _state: {
                states: [],
                style: { _wwHover_default: { boxShadow: '0 0 0 3px blue' } },
                classes: { _wwActive: ['classA'] },
                subClasses: { _wwFocusVisible: ['classB'] },
            },
            content: { _wwFocus_default: { text: 'orphaned focus content' } },
        };

        const states = createEditorStyleCompilerSources().reader.element('elementA')?.states();

        expect(states).toEqual([]);
    });

    it('keeps native states that are explicitly declared', () => {
        elements.elementA = {
            uid: 'elementA',
            parentSectionId: 'sectionA',
            _state: {
                states: [{ id: '_wwHover', label: 'Hover' }],
                style: { _wwHover_default: { boxShadow: '0 0 0 3px blue' } },
            },
        };

        const states = createEditorStyleCompilerSources().reader.element('elementA')?.states();

        expect(states).toEqual([{ id: '_wwHover', label: 'Hover' }]);
    });

    it('ignores undeclared parent native states persisted outside the state list', () => {
        elements.parent = {
            uid: 'parent',
            parentSectionId: 'sectionA',
            _state: { states: [{ id: '_wwHover', label: 'Hover' }] },
        };
        elements.child = {
            uid: 'child',
            parentSectionId: 'sectionA',
            _state: {
                states: [],
                style: { _wwParent_parent__wwHover_default: { opacity: 0.5 } },
            },
        };

        const states = createEditorStyleCompilerSources().reader.element('child')?.states();

        expect(states).toEqual([]);
    });

    it('keeps parent native states that are explicitly declared', () => {
        elements.parent = {
            uid: 'parent',
            parentSectionId: 'sectionA',
            _state: { states: [{ id: '_wwHover', label: 'Hover' }] },
        };
        elements.child = {
            uid: 'child',
            parentSectionId: 'sectionA',
            _state: {
                states: [{ id: '_wwParent_parent__wwHover', label: 'Parent:Hover' }],
                style: { _wwParent_parent__wwHover_default: { opacity: 0.5 } },
            },
        };

        const states = createEditorStyleCompilerSources().reader.element('child')?.states();

        expect(states).toEqual([
            {
                id: '_wwParent_parent__wwHover',
                parent: {
                    uid: 'parent',
                    stateId: '_wwHover',
                    selector: createElementSelector('parent'),
                },
            },
        ]);
    });

    it('ignores declared parent native states that no longer exist on the parent', () => {
        elements.parent = {
            uid: 'parent',
            parentSectionId: 'sectionA',
            _state: { states: [] },
        };
        elements.child = {
            uid: 'child',
            parentSectionId: 'sectionA',
            _state: {
                states: [{ id: '_wwParent_parent__wwHover', label: 'Parent:Hover' }],
                style: { _wwParent_parent__wwHover_default: { opacity: 0.5 } },
            },
        };

        const states = createEditorStyleCompilerSources().reader.element('child')?.states();

        expect(states).toEqual([]);
    });

    it('ignores custom parent states that no longer exist on the parent', () => {
        elements.parent = {
            uid: 'parent',
            parentSectionId: 'sectionA',
            _state: { states: [] },
        };
        elements.child = {
            uid: 'child',
            parentSectionId: 'sectionA',
            _state: {
                states: [{ id: '_wwParent_parent_open', label: 'Parent:Open' }],
                style: { _wwParent_parent_open_default: { opacity: 0.5 } },
            },
        };

        const states = createEditorStyleCompilerSources().reader.element('child')?.states();

        expect(states).toEqual([]);
    });

    it('ignores parent states whose parent source no longer exists', () => {
        elements.child = {
            uid: 'child',
            parentSectionId: 'sectionA',
            _state: {
                states: [{ id: '_wwParent_deletedParent_open', label: 'Deleted parent:Open' }],
                style: { _wwParent_deletedParent_open_default: { opacity: 0.5 } },
            },
        };

        const states = createEditorStyleCompilerSources().reader.element('child')?.states();

        expect(states).toEqual([]);
    });

    it('ignores undeclared configured-selector states persisted outside the state list', () => {
        componentConfigurations.set('element:configuredBase', {
            states: [{ label: 'focus', selectors: ['&:focus-within'] }],
        });
        elements.elementA = {
            uid: 'elementA',
            wwObjectBaseId: 'configuredBase',
            parentSectionId: 'sectionA',
            _state: {
                states: [],
                style: { focus_default: { opacity: 0.5 } },
            },
        };

        const states = createEditorStyleCompilerSources().reader.element('elementA')?.states();

        expect(states).toEqual([]);
    });

    it('ignores undeclared parent configured-selector states persisted outside the state list', () => {
        componentConfigurations.set('element:configuredBase', {
            states: [{ label: 'focus', selectors: ['&:focus-within'] }],
        });
        elements.parent = {
            uid: 'parent',
            wwObjectBaseId: 'configuredBase',
            parentSectionId: 'sectionA',
            _state: { states: [{ id: 'focus', label: 'focus' }] },
        };
        elements.child = {
            uid: 'child',
            parentSectionId: 'sectionA',
            _state: {
                states: [],
                style: { _wwParent_parent_focus_default: { opacity: 0.5 } },
            },
        };

        const states = createEditorStyleCompilerSources().reader.element('child')?.states();

        expect(states).toEqual([]);
    });
});

describe('styleCompilerReader target lifecycle', () => {
    function compileEditorStylesheet() {
        const sources = createEditorStyleCompilerSources();
        const stylesheet = createStringStyleSheetAdapter();
        const run = createStyleCompiler().compileStylesheet({
            scope: createReactiveCompileScope(sources.scope),
            reader: sources.reader,
            stylesheet,
            runtime: {
                createScope: effectScope,
                effect: callback => watchEffect(callback),
            },
        });

        return { run, stylesheet };
    }

    it('removes generated CSS when an element is deleted', async () => {
        elements.elementA = {
            uid: 'elementA',
            parentSectionId: 'sectionA',
            _state: { style: { default: { width: '100px' } } },
            content: { default: {} },
        };

        const { run, stylesheet } = compileEditorStylesheet();

        try {
            await nextTick();
            expect(stylesheet.result()).toContain(createElementSelector('elementA'));
            expect(stylesheet.result()).toContain('width: 100px;');

            delete elements.elementA;
            await nextTick();

            expect(stylesheet.result()).not.toContain(createElementSelector('elementA'));
        } finally {
            run.stop();
        }
    });

    it('replaces an element at the same uid without keeping stale declarations', async () => {
        elements.elementA = {
            uid: 'elementA',
            parentSectionId: 'sectionA',
            _state: { style: { default: { width: '100px' } } },
            content: { default: {} },
        };

        const { run, stylesheet } = compileEditorStylesheet();

        try {
            await nextTick();
            expect(stylesheet.result()).toContain('width: 100px;');

            elements.elementA = {
                uid: 'elementA',
                parentSectionId: 'sectionA',
                _state: { style: { default: { width: '240px' } } },
                content: { default: {} },
            };
            await nextTick();

            expect(stylesheet.result()).toContain('width: 240px;');
            expect(stylesheet.result()).not.toContain('width: 100px;');
        } finally {
            run.stop();
        }
    });
});

describe('styleCompilerReader section roots', () => {
    it('exposes persisted dense ids without deriving them reactively', () => {
        elements.element = { uid: 'element', _si: 42 };
        sections.sectionA = { uid: 'sectionA', _si: 7 };

        const reader = createEditorStyleCompilerSources().reader;

        expect(reader.element('element')?.styleSourceId?.()).toBe(42);
        expect(reader.section('sectionA')?.styleSourceId?.()).toBe(7);
    });

    it('reactively distinguishes direct section children from nested elements sharing the section id', async () => {
        const sectionRootElements = reactive([{ uid: 'root' }]);
        sections.sectionA = {
            uid: 'sectionA',
            content: { default: { wwObjects: sectionRootElements } },
        };
        elements.root = { uid: 'root', parentSectionId: 'sectionA' };
        elements.nested = { uid: 'nested', parentSectionId: 'sectionA' };

        const reader = createEditorStyleCompilerSources().reader;

        expect(reader.element('root')?.isDirectSectionChild()).toBe(true);
        expect(reader.element('nested')?.isDirectSectionChild()).toBe(false);

        const updates: boolean[] = [];
        const stop = watchEffect(() => updates.push(reader.element('nested')?.isDirectSectionChild() ?? false));

        sectionRootElements.push({ uid: 'nested' });
        await nextTick();

        expect(updates).toEqual([false, true]);
        stop();
    });
});

describe('styleCompilerReader component capabilities', () => {
    it('exposes auto-by-content sizing to the compiler', () => {
        componentConfigurations.set('element:autoSizedBase', { options: { autoByContent: true } });
        elements.button = { uid: 'button', wwObjectBaseId: 'autoSizedBase' };

        const capabilities = createEditorStyleCompilerSources().reader.element('button')?.capabilities();

        expect(capabilities?.autoByContent).toBe(true);
    });

    it('preserves unresolved style inheritance for library component instances', () => {
        elements.libraryInstance = createLibraryInstance('libraryInstance', 'libraryA');
        elements.regularElement = createElement('regularElement', 'flexRootBase');

        const reader = createEditorStyleCompilerSources().reader;

        expect(reader.element('libraryInstance')?.capabilities?.().omitUndefinedDynamicValues).toBe(true);
        expect(reader.element('regularElement')?.capabilities?.().omitUndefinedDynamicValues).toBe(false);
    });

    it('exposes inherited and component content property state capabilities', () => {
        componentConfigurations.set('element:customBase', {
            inherit: 'ww-layout',
            properties: {
                statefulProperty: { states: true },
                staticProperty: {},
                '_ww-layout_flexDirection': { states: true },
            },
        });
        elements.element = createElement('element', 'customBase');

        const content = createEditorStyleCompilerSources().reader.element('element')?.content();

        expect(content?.supportsState?.('_ww-layout_rowGap')).toBe(true);
        expect(content?.supportsState?.('_ww-layout_flexDirection')).toBe(false);
        expect(content?.supportsState?.('statefulProperty')).toBe(true);
        expect(content?.supportsState?.('staticProperty')).toBe(false);
        expect(content?.supportsState?.('unknownProperty')).toBe(false);

        componentConfigurations.get('element:customBase')!.properties!.statefulProperty.states = false;
        expect(content?.supportsState?.('statefulProperty')).toBe(false);
    });

    it('keeps inherited state capabilities aligned with the authoritative configurations', () => {
        const inheritedConfigurations = [
            ['ww-text', TEXT_CONFIGURATION.properties],
            [
                'ww-layout',
                {
                    ...LAYOUT_CONFIGURATION.properties,
                    ...GRID_CONFIGURATION.properties,
                },
            ],
            ['ww-background-video', BACKGROUND_VIDEO_CONFIGURATION.properties],
        ] as const;

        for (const [inherit, properties] of inheritedConfigurations) {
            const supportsState = getContentPropertyStateSupport(getInheritedConfiguration({ inherit }));
            for (const [property, configuration] of Object.entries(properties)) {
                expect(supportsState(property), `${inherit}.${property}`).toBe(configuration.states === true);
            }
        }
    });
});

describe('styleCompilerReader library component display capabilities', () => {
    it('exposes the immediate library root chain for legacy composite layout inheritance', () => {
        elements.pageInstance = createLibraryInstance('pageInstance', 'libraryA');
        elements.nestedInstance = createLibraryInstance('nestedInstance', 'libraryB');
        elements.concreteRoot = createElement('concreteRoot', 'flexRootBase');
        libraryComponents.libraryA = { rootElementId: 'nestedInstance' };
        libraryComponents.libraryB = { rootElementId: 'concreteRoot' };

        const pageReader = createEditorStyleCompilerSources().reader.element('pageInstance');
        const nestedReader = pageReader?.effectiveFallbackSource?.();

        expect(nestedReader?.uid()).toBe('nestedInstance');
        expect(nestedReader?.effectiveFallbackSource?.()?.uid()).toBe('concreteRoot');
        expect(nestedReader?.effectiveFallbackSource?.()?.effectiveFallbackSource?.()).toBeNull();
    });

    it('compiles an instance display override with the concrete library root display values', () => {
        elements.libraryRoot = createElement('libraryRoot', 'flexRootBase', true, {
            '_ww-layout_flexDirection': 'row',
            '_ww-layout_alignItems': 'center',
        });
        elements.pageInstance = createLibraryInstance('pageInstance', 'libraryA', true);
        libraryComponents.libraryA = { rootElementId: 'libraryRoot' };

        const stylesheet = createStringStyleSheetAdapter();
        const run = createStyleCompiler().compileStylesheet({
            scope: {
                elementUids: ['pageInstance'],
                sectionUids: [],
                libraryComponentIds: ['libraryA'],
            },
            reader: createEditorStyleCompilerSources().reader,
            stylesheet,
            runtime: STATIC_STYLE_RUNTIME,
        });
        const instanceSelector = createElementSelector('pageInstance');
        const instanceRuleStart = run.result.indexOf(`${instanceSelector} {`);
        const instanceRule = run.result.slice(instanceRuleStart, run.result.indexOf('}', instanceRuleStart) + 1);

        expect(instanceRule).toContain('display: flex;');
        expect(instanceRule).not.toContain('display: block;');
        expect(run.result).toContain('align-items: center;');

        run.stop();
    });

    it('resolves nested library roots recursively and reacts when the concrete root changes', async () => {
        elements.pageInstance = createLibraryInstance('pageInstance', 'libraryA', true);
        elements.nestedInstance = createLibraryInstance('nestedInstance', 'libraryB');
        elements.flexRoot = createElement('flexRoot', 'flexRootBase', true);
        elements.gridRoot = createElement('gridRoot', 'gridRootBase', true);
        libraryComponents.libraryA = { rootElementId: 'nestedInstance' };
        libraryComponents.libraryB = { rootElementId: 'flexRoot' };
        const reader = createEditorStyleCompilerSources().reader;
        const instanceReader = reader.element('pageInstance');
        const allowedValueUpdates: (readonly string[] | undefined)[] = [];
        const stop = watchEffect(() => {
            allowedValueUpdates.push(instanceReader?.capabilities?.().displayAllowedValues);
        });

        expect(allowedValueUpdates.at(-1)).toEqual(['flex', 'inline-flex']);

        libraryComponents.libraryB.rootElementId = 'gridRoot';
        await nextTick();

        expect(allowedValueUpdates.at(-1)).toEqual(['grid', 'inline-grid']);

        stop();
    });

    it('keeps the generic display fallback when a nested library root cycle cannot be resolved', () => {
        elements.pageInstance = createLibraryInstance('pageInstance', 'libraryA', true);
        elements.nestedA = createLibraryInstance('nestedA', 'libraryB');
        elements.nestedB = createLibraryInstance('nestedB', 'libraryA');
        libraryComponents.libraryA = { rootElementId: 'nestedA' };
        libraryComponents.libraryB = { rootElementId: 'nestedB' };

        const capabilities = createEditorStyleCompilerSources().reader.element('pageInstance')?.capabilities?.();

        expect(capabilities?.displayAllowedValues).toEqual(['block', 'inline-block']);
    });
});

function createElement(uid: string, wwObjectBaseId: string, display?: unknown, content: Record<string, unknown> = {}) {
    return {
        uid,
        wwObjectBaseId,
        libraryComponentBaseId: null,
        _state: display === undefined ? {} : { style: { default: { display } } },
        content: { default: content },
    };
}

function createLibraryInstance(uid: string, libraryComponentBaseId: string, display?: unknown) {
    return {
        uid,
        wwObjectBaseId: null,
        libraryComponentBaseId,
        _state: display === undefined ? {} : { style: { default: { display } } },
        content: { default: {} },
    };
}
