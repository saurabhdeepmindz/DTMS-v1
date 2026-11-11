// @vitest-environment jsdom
import { createApp, defineComponent, h, nextTick, reactive, ref } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/_front/components/wwPageLoadProgress.vue', () => ({ default: { render: () => null } }));
vi.mock('@/_front/components/wwFrontPopup.vue', () => ({ default: { render: () => null } }));
vi.mock('@/_front/components/WwObjectDragPreviewHost.vue', () => ({ default: { render: () => null } }));
vi.mock('@/_manager/onboarding/OnboardingTextArea.vue', () => ({ default: { render: () => null } }));
vi.mock('@/_front/use/useStyleCompilerRuntime', () => ({ usePageStyleCompilerRuntime: vi.fn() }));
vi.mock('@/_front/helpers/wwBackgroungStyle.js', () => ({ getBackgroundStyle: () => '' }));
vi.mock('@/_common/editor/use/useLocalInformation', () => ({ getComponentLocalInformation: vi.fn() }));
vi.mock('@/_manager/services/chatgptEmbed.js', () => ({ isEditorEmbedSession: () => false }));
vi.mock('@/_common/editor/interaction/repeatManipulation', () => ({ getRepeatDragOwner: vi.fn() }));
vi.mock('@unhead/vue', () => ({ useHead: vi.fn() }));

// @ts-ignore Vitest resolves this test-only target query through wewebTargetBlockPlugin.
import wwPageEditor from './wwPage.vue?ww-target=editor';
// @ts-ignore Vitest resolves this test-only target query through wewebTargetBlockPlugin.
import wwPageFront from './wwPage.vue?ww-target=front';

const Section = defineComponent({
    props: ['uid', 'sectionIndex'],
    setup: props => () => h('section', { 'data-uid': props.uid, 'data-index': props.sectionIndex }),
});

const mountedApps: ReturnType<typeof createApp>[] = [];

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    for (const app of mountedApps.splice(0)) app.unmount();
    document.body.replaceChildren();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe.each([
    ['editor', wwPageEditor],
    ['front', wwPageFront],
])('wwPage %s section delivery', (target, Page) => {
    it('waits for missing section data and preserves page indexes when it arrives', async () => {
        const sections = reactive<Record<string, { uid: string }>>({ first: { uid: 'first' }, last: { uid: 'last' } });
        vi.stubGlobal('wwLib', {
            store: {
                websiteData: {
                    page: {
                        id: 'page',
                        pageLoaded: true,
                        sections: [{ uid: 'first' }, { uid: 'pending' }, { uid: 'last' }],
                    },
                    sections,
                    designInfo: { id: 'design' },
                    pagesById: {},
                },
                popups: { stackedPopupUids: {}, singlePopupUids: [], instances: {} },
                front: { activeLinkPopup: null, resolvedTheme: 'light' },
                manager: {},
                viewFront: {},
                contextMenu: {},
            },
            editorUXStore: { isEditing: ref(false) },
            editorDragStore: {
                isDraggingElement: ref(false),
                isDraggingSection: ref(false),
                isDraggingPopup: ref(false),
                isPopupDropTarget: ref(false),
                dropElementLayoutId: ref(null),
                dropSectionIndex: ref(null),
                draggedSize: ref(null),
                dragPreviewElementUid: ref(null),
            },
            getEditorWindow: () => window,
            getFrontDocument: () => document,
            wwLang: { getText: () => '' },
            $on: vi.fn(),
            $off: vi.fn(),
        });
        const container = document.createElement('div');
        document.body.append(container);
        const app = createApp(Page);
        const onError = vi.fn();
        app.config.errorHandler = onError;
        app.component('wwSection', Section);
        app.component('wwLinkPopup', { render: () => null });
        app.component('wwElement', { render: () => null });
        app.component('wwEditorIcon', { render: () => null });
        mountedApps.push(app);

        app.mount(container);

        expect(onError).not.toHaveBeenCalled();
        expect([...container.querySelectorAll('section')].map(node => [node.dataset.uid, node.dataset.index])).toEqual([
            ['first', '0'],
            ['last', '2'],
        ]);
        if (target === 'front') {
            expect(container.querySelectorAll('.placeholder-section')).toHaveLength(2);
        }

        sections.pending = { uid: 'pending' };
        await nextTick();

        expect(onError).not.toHaveBeenCalled();
        expect([...container.querySelectorAll('section')].map(node => [node.dataset.uid, node.dataset.index])).toEqual([
            ['first', '0'],
            ['pending', '1'],
            ['last', '2'],
        ]);
        if (target === 'front') {
            expect(container.querySelectorAll('.placeholder-section')).toHaveLength(3);
        }

        delete sections.pending;
        await nextTick();

        expect(onError).not.toHaveBeenCalled();
        expect([...container.querySelectorAll('section')].map(node => node.dataset.uid)).toEqual(['first', 'last']);
    });
});
