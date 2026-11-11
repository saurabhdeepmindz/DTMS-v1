import { createSSRApp, defineComponent, h, reactive, ref } from 'vue';
import { renderToString } from '@vue/server-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const workflowFixture = vi.hoisted(() => ({
    executeWorkflow: vi.fn(),
}));

vi.mock('@/_common/helpers/code/workflows.js', () => ({
    executeWorkflow: workflowFixture.executeWorkflow,
}));
vi.mock('@/_front/rendering/runtimeLifecycleScheduler', () => ({
    scheduleRuntimeLifecycle: (callback: () => void) => callback(),
}));

import { useComponentTriggerEvent, useLibraryComponentWorkflow } from './useComponent.js';

describe('drag preview component runtime', () => {
    beforeEach(() => {
        workflowFixture.executeWorkflow.mockReset();
        vi.stubGlobal('wwLib', {
            editorUXStore: { isEditing: ref(false) },
            $store: {
                getters: {
                    'libraries/getComponents': {
                        'library-base': {
                            inner: {
                                workflows: {
                                    propertyChange: {
                                        trigger: '_wwOnPropertyChange',
                                        triggerProperty: 'title',
                                    },
                                },
                            },
                        },
                    },
                },
            },
        });
    });

    it('does not execute element lifecycle workflows', async () => {
        const app = createSSRApp(
            defineComponent({
                setup() {
                    useComponentTriggerEvent({
                        state: { interactions: [{ trigger: '_wwOnCreated' }] },
                        componentIdentifier: { type: 'element', componentId: 1, uid: 'preview-element' },
                        triggerLibraryComponentEvent: undefined,
                        triggerParentEvent: undefined,
                        parentInteractionsRef: undefined,
                        isRenderingRef: ref(false),
                        rootElementRef: undefined,
                        isRuntimePreview: true,
                    });
                    return () => h('div');
                },
            })
        );

        await renderToString(app);

        expect(workflowFixture.executeWorkflow).not.toHaveBeenCalled();
    });

    it('does not execute library property-change workflows', async () => {
        const app = createSSRApp(
            defineComponent({
                setup() {
                    useLibraryComponentWorkflow(
                        {
                            baseUid: 'library-base',
                            componentIdentifier: {
                                type: 'libraryComponent',
                                componentId: 1,
                                uid: 'preview-library',
                            },
                            isRuntimePreview: true,
                        },
                        reactive({ component: { props: { title: 'Preview' } } })
                    );
                    return () => h('div');
                },
            })
        );

        await renderToString(app);

        expect(workflowFixture.executeWorkflow).not.toHaveBeenCalled();
    });
});
