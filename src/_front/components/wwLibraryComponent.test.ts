import { withStoreRegistry } from '@/pinia/testRegistry.test-support';
import '@/pinia/domainFixtures.test-support';
import { createSSRApp, defineComponent, h } from 'vue';
import { renderToString } from '@vue/server-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const libraryFixture = vi.hoisted(() => ({
    capturedLayoutData: [] as Array<Record<string, unknown>>,
    capturedRootClasses: [] as unknown[],
    capturedRuntimeStyleSources: [] as unknown[],
}));

vi.mock('@/_common/helpers/component/component.js', () => ({
    getComponentBaseUid: () => 'library-base',
    getComponentIcon: () => 'component',
    getComponentLabel: () => 'Library component',
}));
vi.mock('@/_common/editor/use/useEditorSelection.js', async () => {
    const { ref } = await import('vue');
    return { useIsSelected: () => ({ isSelected: ref(false), isExactlySelected: ref(false) }) };
});
vi.mock('@/_common/editor/use/useEditorHover.js', async () => {
    const { ref } = await import('vue');
    return { useIsElementHovered: () => ({ isHovered: ref(false) }) };
});
vi.mock('@/_front/use/editor/useElementMenu.js', async () => {
    const { ref } = await import('vue');
    return { useElementMenu: () => ({ isMenuOpen: ref(false) }) };
});
vi.mock('@/_common/editor/use/useEditorDrag', () => ({ useIsElementDragged: vi.fn() }));
vi.mock('@/_front/use/editor/useEditorLibraryComponent.js', async () => {
    const { ref } = await import('vue');
    return {
        useIsLibraryComponentEditing: () => ref(false),
        useCanInteract: () => ref({ canInteract: false }),
        useCanBeEdited: () => ref(false),
    };
});
vi.mock('@/_common/editor/use/useLocalInformation.js', () => ({ useRegisterLocalInformation: vi.fn() }));
vi.mock('@/_common/use/useComponent.js', async () => {
    const { reactive, ref } = await import('vue');
    return {
        useComponentData: () => ({
            content: reactive({ childrenData: {} }),
            state: reactive({}),
            rawContent: reactive({}),
            rawState: reactive({}),
            name: ref('Library instance'),
            componentConditionalRendering: ref(true),
            rawConditionalRendering: ref(true),
            componentLayoutRuntime: {
                inheritsLayout: true,
                display: () => 'grid',
                textAlign: () => 'right',
                rawDisplay: () => ({ __wwtype: 'f', code: 'instanceDisplay' }),
                displayValue: () => 'grid',
                rawTextAlign: () => ({ __wwtype: 'f', code: 'instanceTextAlign' }),
            },
            boundProps: reactive({}),
            sidepanelContent: reactive({}),
        }),
        useComponentTriggerEvent: () => vi.fn(),
        useLibraryComponentWorkflow: () => ({
            triggerLibraryComponentEvent: vi.fn(),
            executeLibraryComponentWorkflow: vi.fn(),
        }),
    };
});
vi.mock('@/_common/helpers/styleCompiler', async importOriginal => ({
    ...(await importOriginal<typeof import('@/_common/helpers/styleCompiler')>()),
    createElementClassName: () => 'library-instance',
}));
vi.mock('@/_front/use/useInner.js', () => ({
    useInner: () => ({
        variables: {},
        updateVariable: vi.fn(),
        formulas: {},
        componentVariablesConfiguration: {},
    }),
}));
vi.mock('@/_front/use/useComponentStates.js', async () => {
    const { ref } = await import('vue');
    return {
        useComponentStates: () => ({
            currentStates: ref([]),
            currentStatesAttribute: ref(''),
            forcedStatesAttribute: ref(''),
            addInternalState: vi.fn(),
            removeInternalState: vi.fn(),
            possibleParentStates: ref([]),
        }),
    };
});
vi.mock('@/_common/use/useActions.js', () => ({ useLibraryComponentActions: vi.fn() }));
vi.mock('@/_front/use/useStyleCompilerDynamicVariables', () => ({ useStyleCompilerDynamicVariables: vi.fn() }));
vi.mock('@/_front/services/styleCompilerAtomicClasses', () => ({
    getStyleAtomicClassesForSource: () => ['ww-a-instance-default'],
}));
vi.mock('@/_front/use/useLayoutStyleScopes', () => ({ provideLibraryComponentLayoutStyleScope: vi.fn() }));
vi.mock('@/pinia/popup', () => ({ usePopupStore: () => ({}) }));
vi.mock('./ComponentLoader.vue', () => ({
    default: defineComponent({
        setup(_, { slots }) {
            return () => slots.default?.();
        },
    }),
}));
vi.mock('./wwElementComponent.vue', () => ({
    default: defineComponent({
        props: {
            libraryComponentData: { type: Object, default: undefined },
            libraryComponentRuntimeStyleSourceUid: { type: String, default: undefined },
            libraryComponentRuntimeStyleContext: { type: Object, default: undefined },
        },
        setup(props, { attrs }) {
            return () => {
                libraryFixture.capturedRootClasses.push(attrs.class);
                libraryFixture.capturedRuntimeStyleSources.push(props.libraryComponentRuntimeStyleSourceUid);
                const layout = props.libraryComponentData?.layout;
                if (layout) {
                    libraryFixture.capturedLayoutData.push({
                        displayRaw: layout.display?.raw(),
                        displayValue: layout.display?.value(),
                        textAlignRaw: layout.textAlign?.raw(),
                        textAlignValue: layout.textAlign?.value(),
                    });
                }
                return h('div', attrs);
            };
        },
    }),
}));

// @ts-ignore Vitest resolves this test-only target query through wewebTargetBlockPlugin.
import wwLibraryComponentEditor from './wwLibraryComponent.vue?ww-target=editor';
// @ts-ignore Vitest resolves this test-only target query through wewebTargetBlockPlugin.
import wwLibraryComponentFront from './wwLibraryComponent.vue?ww-target=front';

function installWwLib({ hasBase = true } = {}) {
    vi.stubGlobal('wwLib', withStoreRegistry({
        $store: {
            getters: {
                'libraries/getComponents': hasBase ? { 'library-base': { rootElementId: 'root-element' } } : {},
            },
        },
        editorUXStore: {
            isTogglingPopup: false,
            stopEditingComponent: vi.fn(),
        },
        editorSelectionStore: {
            unselectAllComponents: vi.fn(),
        },
    }));
}

describe('wwLibraryComponent Vue adapter', () => {
    beforeEach(() => {
        libraryFixture.capturedLayoutData.length = 0;
        libraryFixture.capturedRootClasses.length = 0;
        libraryFixture.capturedRuntimeStyleSources.length = 0;
        installWwLib();
    });

    it.each([
        ['Editor', wwLibraryComponentEditor],
        ['Front', wwLibraryComponentFront],
    ])('forwards page-instance atomic classes to its concrete root in %s', async (_, target) => {
        const app = createSSRApp({
            render: () => h(target, { uid: 'library-instance' }),
        });

        const html = await renderToString(app);

        expect(html).toContain('ww-a-instance-default');
        expect(libraryFixture.capturedRuntimeStyleSources).toEqual(['library-instance']);
    });

    it.each([
        ['Editor', wwLibraryComponentEditor],
        ['Front', wwLibraryComponentFront],
    ])('forwards raw and unnormalized evaluated layout overrides to its concrete root in %s', async (_, target) => {
        const app = createSSRApp({
            render: () => h(target, { uid: 'library-instance' }),
        });

        await renderToString(app);

        expect(libraryFixture.capturedLayoutData).toEqual([
            {
                displayRaw: { __wwtype: 'f', code: 'instanceDisplay' },
                displayValue: 'grid',
                textAlignRaw: { __wwtype: 'f', code: 'instanceTextAlign' },
                textAlignValue: 'right',
            },
        ]);
    });

    it('keeps legacy push-last style on a missing library placeholder', async () => {
        installWwLib({ hasBase: false });
        const app = createSSRApp({
            render: () =>
                h(wwLibraryComponentEditor, {
                    uid: 'missing-library-instance',
                    'extra-style': { marginLeft: 'auto' },
                }),
        });

        const html = await renderToString(app);

        expect(html).toContain('style="margin-left:auto;"');
        expect(html).toContain('Component from library missing');
    });
});
