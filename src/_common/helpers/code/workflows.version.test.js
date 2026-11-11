import { withStoreRegistry } from '@/pinia/testRegistry.test-support';
import '@/pinia/domainFixtures.test-support';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSelectionCopy = vi.hoisted(() => vi.fn(() => false));
vi.mock('./editorClipboard', () => ({ copyTextWithSelection: mockSelectionCopy }));

const mockVariablesStore = vi.hoisted(() => ({
    getConfiguration: vi.fn(),
    components: {},
    values: {},
    setValue: vi.fn(),
}));

const mockBackTableViewsStore = vi.hoisted(() => ({
    fetchData: vi.fn(),
    fetchMore: vi.fn(),
    latestFetchParameters: {},
    data: {},
}));

vi.mock('@/_common/use/useActions.js', () => ({
    executeComponentAction: vi.fn(),
}));

vi.mock('@/_common/helpers/code/workflowsCallstack.js', () => ({
    detectInfinityLoop: vi.fn(() => false),
}));

vi.mock('@/_common/helpers/updateVariable.js', () => ({
    applyVariableUpdate: vi.fn(),
}));

vi.mock('@/pinia/variables.js', () => ({
    useVariablesStore: vi.fn(() => mockVariablesStore),
}));

vi.mock('@/_common/helpers/code/backendWorkflows.js', () => ({
    executeBackendWorkflow: vi.fn(),
    parseSSEStreamAsync: vi.fn(),
}));

vi.mock('@/pinia/popup', () => ({
    usePopupStore: vi.fn(() => ({})),
}));

vi.mock('@/pinia/backTableViews.js', () => ({
    useBackTableViewsStore: vi.fn(() => mockBackTableViewsStore),
}));

vi.mock('@better-fetch/fetch', () => ({
    betterFetch: vi.fn(),
}));

vi.mock('@/extensions/integrations/index.js', () => ({
    default: {},
}));

vi.mock('@/pinia/integrations', () => ({
    useIntegrationsStore: vi.fn(() => ({
        getCodeBindings: vi.fn(() => ({})),
    })),
}));

vi.mock('@/pinia/backAuth', () => ({
    useBackAuthStore: vi.fn(() => ({})),
}));

vi.mock('@/pinia/editor/debugger.js', () => ({
    useDebuggerStore: vi.fn(() => ({
        startWorkflow: vi.fn(() => 'execution-id'),
        stopWorkflow: vi.fn(),
        log: vi.fn(),
    })),
}));

import { executeWorkflow } from './workflows.js';
import { executeWorkflow as executePublishedWorkflow } from './workflows.js?ww-target=front';

describe('executeWorkflow actions and versioned formula handling', () => {
    const dispatch = vi.fn();
    const updateValue = vi.fn((_, value) => value);

    beforeEach(() => {
        globalThis.FileList = class FileList {};
        dispatch.mockReset();
        mockSelectionCopy.mockReset().mockReturnValue(false);
        updateValue.mockClear();
        mockVariablesStore.getConfiguration.mockReset();
        mockVariablesStore.setValue.mockReset();
        mockBackTableViewsStore.fetchData.mockReset();
        mockBackTableViewsStore.fetchMore.mockReset();
        mockVariablesStore.components = {};
        mockVariablesStore.values = {};
        globalThis.wwLib = withStoreRegistry({
            WW_SAFE_MODE_HARD: 'hard',
            $pinia: {},
            $store: {
                getters: {
                    'manager/getSafeMode': null,
                    'data/getWorkflowResults': vi.fn(() => ({})),
                    'data/getFormulas': {},
                    'data/getPluginFormulas': {},
                    'data/getCollections': {},
                    'libraries/getComponents': {},
                },
                dispatch,
            },
            globalVariables: {
                customCodeVariables: {},
            },
            wwVariable: {
                updateValue,
            },
        });
    });

    it('copies from the canvas window when the editor document cannot write to the clipboard', async () => {
        const editorWrite = vi.fn().mockRejectedValue(new DOMException('Document is not focused.', 'NotAllowedError'));
        const canvasWrite = vi.fn().mockResolvedValue(undefined);
        const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
        Object.defineProperty(globalThis, 'navigator', {
            configurable: true,
            value: { clipboard: { writeText: editorWrite } },
        });
        globalThis.wwLib.getFrontWindow = () => ({ navigator: { clipboard: { writeText: canvasWrite } } });

        try {
            const execution = await executeWorkflow({
                id: 'clipboard-workflow',
                firstAction: 'copy',
                actions: { copy: { id: 'copy', type: 'copy-clipboard', value: 'Copied from preview' } },
            });

            expect(execution.error).toBeUndefined();
            expect(canvasWrite).toHaveBeenCalledWith('Copied from preview');
            expect(editorWrite).not.toHaveBeenCalled();
        } finally {
            if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
            else delete globalThis.navigator;
        }
    });

    it('keeps the copy result and string conversion in the published window', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        globalThis.wwLib.getFrontWindow = () => ({ navigator: { clipboard: { writeText } } });
        const execution = await executePublishedWorkflow({
            id: 'clipboard-workflow',
            firstAction: 'copy',
            actions: { copy: { id: 'copy', type: 'copy-clipboard', value: 42 } },
        });

        expect(execution.error).toBeUndefined();
        expect(writeText).toHaveBeenCalledWith('42');
        expect(dispatch).toHaveBeenCalledWith('data/setWorkflowActionResult', expect.objectContaining({ result: 42 }));
    });

    it('uses the canvas selection fallback only for editor clipboard permission errors', async () => {
        const document = {};
        const writeText = vi.fn().mockRejectedValue(new DOMException('Write permission denied.', 'NotAllowedError'));
        mockSelectionCopy.mockReturnValue(true);
        globalThis.wwLib.getFrontWindow = () => ({ document, navigator: { clipboard: { writeText } } });
        const execution = await executeWorkflow({
            id: 'clipboard-workflow',
            firstAction: 'copy',
            actions: { copy: { id: 'copy', type: 'copy-clipboard', value: 'test' } },
        });

        expect(execution.error).toBeUndefined();
        expect(mockSelectionCopy).toHaveBeenCalledWith('test', document);
    });

    it('keeps published clipboard permission failures without the editor fallback', async () => {
        const error = new DOMException('Write permission denied.', 'NotAllowedError');
        const writeText = vi.fn().mockRejectedValue(error);
        mockSelectionCopy.mockReturnValue(true);
        globalThis.wwLib.getFrontWindow = () => ({ navigator: { clipboard: { writeText } } });
        const execution = await executePublishedWorkflow({
            id: 'clipboard-workflow',
            firstAction: 'copy',
            actions: { copy: { id: 'copy', type: 'copy-clipboard', value: 'test' } },
        });

        expect(execution.error).toBe(error);
        expect(mockSelectionCopy).not.toHaveBeenCalled();
    });

    it('reports clipboard permission failures through the workflow error path', async () => {
        const error = new DOMException('Write permission denied.', 'NotAllowedError');
        const writeText = vi.fn().mockRejectedValue(error);
        globalThis.wwLib.getFrontWindow = () => ({ navigator: { clipboard: { writeText } } });
        const execution = await executeWorkflow({
            id: 'clipboard-workflow',
            firstAction: 'copy',
            actions: { copy: { id: 'copy', type: 'copy-clipboard', value: 'test' } },
        });

        expect(execution.error).toBe(error);
        expect(dispatch).toHaveBeenCalledWith(
            'data/setWorkflowError',
            expect.objectContaining({
                workflowId: 'clipboard-workflow',
                value: expect.objectContaining({ name: 'NotAllowedError' }),
            })
        );
    });

    it.each([
        ['editor', executeWorkflow],
        ['published', executePublishedWorkflow],
    ])(
        'uses the appropriate upload client in the %s build without sending editor credentials to S3',
        async (target, run) => {
            const originalAxios = globalThis.axios;
            const originalWwAxios = globalThis.wwAxios;
            const data = {
                signedRequest: 'https://upload.example/fixture',
                url: 'https://storage.example/fixture',
                name: 'photo',
                ext: 'png',
                size: 3,
            };
            const publicPost = vi.fn().mockResolvedValue({ data });
            const editorPost = vi.fn().mockResolvedValue({ data });
            const put = vi.fn().mockResolvedValue({});
            globalThis.axios = { post: publicPost, put };
            globalThis.wwAxios = { post: editorPost };
            globalThis.wwLib.wwApiRequests = { _getApiUrl: () => 'https://api.example/v1' };
            globalThis.wwLib.$store.getters['websiteData/getDesignInfo'] = { id: 'project-id' };
            const file = { name: 'photo.png', type: 'image/png', size: 3 };
            try {
                const execution = await run({
                    id: 'upload-workflow',
                    firstAction: 'upload',
                    actions: { upload: { id: 'upload', type: 'upload-file', varId: file } },
                });
                expect(execution.error).toBeUndefined();
                const expectedPost = target === 'editor' ? editorPost : publicPost;
                const unusedPost = target === 'editor' ? publicPost : editorPost;
                expect(expectedPost).toHaveBeenCalledWith(
                    'https://api.example/v1/designs/project-id/user-files',
                    expect.objectContaining({ name: 'photo.png', type: 'image/png', size: 3 })
                );
                expect(unusedPost).not.toHaveBeenCalled();
                expect(put).toHaveBeenCalledWith(
                    data.signedRequest,
                    file,
                    expect.objectContaining({ skipAuthorization: true })
                );
            } finally {
                globalThis.axios = originalAxios;
                globalThis.wwAxios = originalWwAxios;
            }
        }
    );

    it('delegates Table View load-more pagination to the store', async () => {
        const execution = await executeWorkflow({
            id: 'workflow-load-more-table-view',
            firstAction: 'load-more-action',
            actions: {
                'load-more-action': {
                    id: 'load-more-action',
                    type: 'fetch-table-view-load-more',
                    tableViewId: 'table-view-id',
                    limit: 10,
                    group: { __wwtype: 'js', code: "return { id: 'parent-group' }" },
                },
            },
        });

        expect(execution.error).toBeUndefined();
        expect(mockBackTableViewsStore.fetchMore).toHaveBeenCalledWith('table-view-id', {
            parameters: { limit: 10 },
            group: { id: 'parent-group' },
            noLog: true,
        });
        expect(mockBackTableViewsStore.fetchData).not.toHaveBeenCalled();
    });

    it('keeps legacy workflows non-fatal when a config formula fails', async () => {
        const execution = await executeWorkflow({
            id: 'workflow-v1',
            firstAction: 'return-action',
            actions: {
                'return-action': {
                    id: 'return-action',
                    type: 'return',
                    value: {
                        __wwtype: 'f',
                        code: 'missing.value',
                    },
                },
            },
        });

        expect(execution.error).toBeUndefined();
        expect(execution.result).toBeUndefined();
        expect(dispatch).not.toHaveBeenCalledWith('data/setWorkflowError', expect.anything());
    });

    it('fails v2 workflows when a config formula fails', async () => {
        const execution = await executeWorkflow({
            id: 'workflow-v2',
            version: 2,
            firstAction: 'return-action',
            actions: {
                'return-action': {
                    id: 'return-action',
                    type: 'return',
                    value: {
                        __wwtype: 'f',
                        code: 'missing.value',
                    },
                },
            },
        });

        expect(execution.error).toMatchObject({
            name: 'FormulaError',
            message: expect.stringContaining('Formula evaluation error'),
        });
        expect(dispatch).toHaveBeenCalledWith('data/setWorkflowError', {
            workflowId: 'workflow-v2',
            value: expect.objectContaining({
                name: 'FormulaError',
                message: expect.stringContaining('Formula evaluation error'),
            }),
        });
    });

    it('evaluates update-variable formulas once before writing the result', async () => {
        globalThis.wwLib.globalVariables.customCodeVariables.list = [];
        mockVariablesStore.getConfiguration.mockImplementation(variableId =>
            variableId === 'list' ? { id: 'list', type: 'array' } : null
        );

        await executeWorkflow(
            {
                id: 'workflow-update-variable',
                firstAction: 'update-variable-action',
                actions: {
                    'update-variable-action': {
                        id: 'update-variable-action',
                        type: 'update-variable',
                        varId: 'list',
                        varValue: {
                            __wwtype: 'js',
                            code: `
                                const items = variables.list || [];
                                const value = context.item.data;
                                const index = items.indexOf(value);

                                if (index > -1) items.splice(index, 1);
                                else items.push(value);

                                return items;
                            `,
                        },
                    },
                },
            },
            {
                context: {
                    item: {
                        data: 1,
                    },
                },
            }
        );

        expect(updateValue).toHaveBeenCalledWith(
            'list',
            [1],
            expect.objectContaining({
                path: null,
                index: 0,
                arrayUpdateType: undefined,
            })
        );
    });

    it('stores the execution-resolved config for workflow action results', async () => {
        await executeWorkflow({
            id: 'workflow-config',
            firstAction: 'return-action',
            actions: {
                'return-action': {
                    id: 'return-action',
                    type: 'return',
                    value: {
                        __wwtype: 'js',
                        code: 'return "resolved value";',
                    },
                },
            },
        });

        const actionResultCall = dispatch.mock.calls.find(
            ([type, payload]) => type === 'data/setWorkflowActionResult' && payload.actionId === 'return-action'
        );

        expect(actionResultCall).toBeTruthy();
        expect(actionResultCall[1]).toMatchObject({
            workflowId: 'workflow-config',
            actionId: 'return-action',
            result: 'resolved value',
            config: {
                value: 'resolved value',
            },
        });
    });
});
