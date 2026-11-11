import { withStoreRegistry } from '@/pinia/testRegistry.test-support';
import { computed, createSSRApp, defineComponent, h, provide, reactive, ref, unref } from 'vue';
import { renderToString } from '@vue/server-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const layoutFixture = vi.hoisted(() => ({
    items: [
        { uid: 'first', isWwObject: true },
        { uid: 'last', isWwObject: true },
    ],
}));

vi.mock('@/_common/use/useComponent.js', async () => {
    const { computed } = await import('vue');
    return {
        useParentContentProperty: () => ({
            rawProperty: computed(() => layoutFixture.items),
            property: computed(() => layoutFixture.items),
        }),
    };
});
vi.mock('@/_front/use/useRestoreContext.js', () => ({ useRestoreContext: vi.fn() }));
vi.mock('@/_front/use/useLayoutStyleScopes', async () => {
    const { computed } = await import('vue');
    return { useLayoutStyleScopeAttribute: () => computed(() => '') };
});
vi.mock('@/_front/use/useLayoutItemMarker', async importOriginal => {
    const actual = await importOriginal<typeof import('@/_front/use/useLayoutItemMarker')>();
    return { ...actual, resetLayoutItemIndex: vi.fn() };
});
vi.mock('@/_common/helpers/styleCompiler', () => ({ getFlexDirection: vi.fn(() => 'row') }));
vi.mock('@/_common/editor/interaction/dragPreview', () => ({
    getDragPlaceholderStyle: vi.fn(() => ({})),
    getEmptyLayoutPlaceholderKind: vi.fn(() => null),
}));
vi.mock('@/_common/editor/use/useEditorDrag', async () => {
    const { ref } = await import('vue');
    return { useIsLayoutDragTarget: () => ({ isDragTarget: ref(false), dragIndexTarget: ref(null) }) };
});
vi.mock('@/_front/use/editor/useEditorLibraryComponent.js', async () => {
    const { ref } = await import('vue');
    return {
        useCanLayoutBeEdited: () => ref(false),
        useCanLayoutInteract: () => ref({ canInteract: false }),
    };
});
vi.mock('@/_common/helpers/pathResolver.js', () => ({ getPath: (path: string) => path }));
vi.mock('./wwLayoutItem.vue', () => ({ default: defineComponent({ render: () => null }) }));
import wwLayout from './wwLayout.vue';
import { useLayoutItemStyle } from '@/_front/use/useLayoutItemMarker';
import { moveWwObjectBetweenLayouts } from '@/_common/editor/layout/moveWwObjectBetweenLayouts';

function installWwLib() {
    vi.stubGlobal(
        'wwLib',
        withStoreRegistry({
            wwFormula: { getValue: (value: unknown) => value },
            editorDragStore: {
                isDraggingElement: ref(false),
                dropElementLayoutId: ref(null),
                dropElementLayoutIndex: ref(null),
                dropElementVisuallyConstrained: ref(false),
                dropElementStructuralOrder: ref(null),
                dropElementOperation: ref(null),
                draggedSize: ref(null),
            },
            editorUXStore: {
                isEditing: ref(false),
                editingComponent: ref(null),
            },
            editorSelectionStore: {
                unselectAllComponents: vi.fn(),
                selectComponent: vi.fn(),
            },
            globalVariables: {
                layoutOptions: new Map(),
                componentLayoutChildren: new Map(),
                componentHasTooMuchData: new Map(),
            },
            getFrontDocument: () => null,
            getFrontWindow: () => null,
            $store: { dispatch: vi.fn(), getters: {} },
            $on: vi.fn(),
            $off: vi.fn(),
            $emit: vi.fn(),
        })
    );
}

function createLayoutApp({
    slot,
    elementStyles,
    display = 'flex',
    textAlign,
    inheritsLayout = true,
    root = true,
    resolveDisplay,
    resolveTextAlign,
    slotOmitsItemStyle = false,
}: {
    slot?: (props: Record<string, unknown>) => unknown;
    elementStyles?: unknown[];
    display?: string;
    textAlign?: string;
    inheritsLayout?: boolean;
    root?: boolean;
    resolveDisplay?: () => string;
    resolveTextAlign?: () => string | undefined;
    slotOmitsItemStyle?: boolean;
}) {
    const content = reactive({
        '_ww-layout_flexDirection': 'row',
        '_ww-layout_reverse': false,
        '_ww-layout_pushLast': true,
    });
    const WwElementStub = defineComponent({
        props: {
            extraStyle: { type: Object, default: undefined },
        },
        setup(props) {
            const layoutItemStyle = useLayoutItemStyle();
            return () => {
                elementStyles?.push(props.extraStyle || unref(layoutItemStyle));
                return h('div');
            };
        },
    });
    const app = createSSRApp({
        setup() {
            provide('componentContent', content);
            provide(
                'componentDisplay',
                computed(() => display)
            );
            provide('componentLayoutRuntime', {
                inheritsLayout,
                display: resolveDisplay || (() => display),
                textAlign: resolveTextAlign || (() => textAlign),
                rawDisplay: () => display,
                displayValue: () => display,
                rawTextAlign: () => textAlign,
            });
            provide('_wwElementUid', 'layout-owner');
            provide('componentData', ref({}));

            return () =>
                h(
                    wwLayout,
                    { path: 'children', class: root ? 'ww-element' : undefined },
                    slotOmitsItemStyle
                        ? { default: () => h(WwElementStub, { uid: 'custom-slot-child' }) }
                        : slot
                          ? { default: slot }
                          : undefined
                );
        },
    });
    app.component('wwElement', WwElementStub);
    return app;
}

describe('wwLayout Vue adapter', () => {
    beforeEach(() => {
        installWwLib();
    });

    it('moves a child once across two repeat occurrences of the same authored layout', async () => {
        await renderToString(createLayoutApp({}));
        await renderToString(createLayoutApp({}));
        const options = wwLib.globalVariables.layoutOptions;
        const [first, second] = [...options.keys()];
        const commit = vi.fn();
        const runtime = { prepare: (id, request) => options.get(id).prepareWwObjectMove(request), commit };
        const request = {
            wwObjectId: 'first',
            source: { layoutId: first, index: 0 },
            destination: { layoutId: second, index: 0 },
        };
        await expect(moveWwObjectBetweenLayouts(request, runtime)).resolves.toBe(false);
        expect(commit).not.toHaveBeenCalled();
        request.destination.index = 2;
        await expect(moveWwObjectBetweenLayouts(request, runtime)).resolves.toBe(true);
        const mutation = commit.mock.calls[0][0];
        expect(mutation.originElement.value).toEqual([layoutFixture.items[1], layoutFixture.items[0]]);
        expect(mutation.targetElement).toEqual(mutation.originElement);
        expect(layoutFixture.items.map(item => item.uid)).toEqual(['first', 'last']);
    });

    it('forwards push-last through extraStyle to the default wwElement adapter', async () => {
        const elementStyles: unknown[] = [];

        await renderToString(createLayoutApp({ elementStyles }));

        expect(elementStyles).toEqual([undefined, { marginLeft: 'auto' }]);
    });

    it('preserves authored element-root height while applying block text alignment', async () => {
        const html = await renderToString(createLayoutApp({ display: 'block', textAlign: 'center' }));
        const disabledHtml = await renderToString(
            createLayoutApp({ display: 'block', textAlign: 'center', inheritsLayout: false })
        );

        expect(html).toContain('class="ww-layout ww-element"');
        expect(html).toContain('style="text-align:center;"');
        expect(html).not.toContain('height:100%');
        expect(disabledHtml).not.toContain('height:100%');
        expect(disabledHtml).not.toContain('text-align:center');
    });

    it('keeps legacy fill height on nested block layout surfaces', async () => {
        const html = await renderToString(createLayoutApp({ display: 'block', textAlign: 'center', root: false }));

        expect(html).toContain('style="height:100%;text-align:center;"');
    });

    it('does not resolve layout values when the host does not inherit ww-layout', async () => {
        const resolveDisplay = vi.fn(() => 'block');
        const resolveTextAlign = vi.fn(() => 'center');

        await renderToString(createLayoutApp({ inheritsLayout: false, resolveDisplay, resolveTextAlign }));

        expect(resolveDisplay).not.toHaveBeenCalled();
        expect(resolveTextAlign).not.toHaveBeenCalled();
    });

    it('does not resolve text alignment outside the legacy block family', async () => {
        const resolveDisplay = vi.fn(() => 'flex');
        const resolveTextAlign = vi.fn(() => 'center');

        await renderToString(createLayoutApp({ resolveDisplay, resolveTextAlign }));

        expect(resolveDisplay).toHaveBeenCalledOnce();
        expect(resolveTextAlign).not.toHaveBeenCalled();
    });

    it('exposes push-last through itemStyle to custom layout slots', async () => {
        const itemStyles: unknown[] = [];
        const slot = (props: Record<string, unknown>) => {
            itemStyles.push(props.itemStyle);
            return h('div');
        };

        await renderToString(createLayoutApp({ slot }));

        expect(itemStyles).toEqual([undefined, { marginLeft: 'auto' }]);
    });

    it('preserves push-last when a custom layout slot omits the itemStyle prop', async () => {
        const elementStyles: unknown[] = [];

        await renderToString(createLayoutApp({ elementStyles, slotOmitsItemStyle: true }));

        expect(elementStyles).toEqual([undefined, { marginLeft: 'auto' }]);
    });
});
