import '@/pinia/domainFixtures.test-support';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { flushHistory, requestWithOptionalSSE, variableValues } = vi.hoisted(() => ({
    flushHistory: vi.fn(),
    requestWithOptionalSSE: vi.fn(),
    variableValues: {},
}));

vi.mock('@/wwLib/servicesManager/wwEditorHistory', () => ({
    default: {
        flushHistory,
    },
}));

vi.mock('@/pinia/variables.js', () => ({
    useVariablesStore: () => ({
        values: variableValues,
    }),
}));

vi.mock('@/_common/helpers/code/editorRequests.ts', async importOriginal => {
    const actual = await importOriginal();
    return {
        ...actual,
        requestWithOptionalSSE,
    };
});

vi.mock('./customCode.js', () => {
    return {
        getValue: vi.fn(value => {
            if (value?.__wwtype === 'f' && value.code === '["text"]') {
                return ['text'];
            }

            return value;
        }),
    };
});

vi.mock('./workflows.js', () => ({
    convertErrorToObject: vi.fn(error => error),
}));

describe('testBackendWorkflow', () => {
    beforeEach(() => {
        flushHistory.mockReset();
        flushHistory.mockResolvedValue();
        requestWithOptionalSSE.mockReset();
        requestWithOptionalSSE.mockResolvedValue({ ok: true });

        for (const key of Object.keys(variableValues)) {
            delete variableValues[key];
        }

        global.localStorage = {
            getItem: vi.fn(() => 'true'),
        };
        global.FileList = class FileList {};

        wwLib.$pinia = {};
        wwLib.$socket = { id: 'socket-id' };
        wwLib.$store.dispatch = vi.fn();
        wwLib.$store.getters['manager/getUser'] = { id: 'user-id' };
    });

    it('builds a multipart body for resolved component file variables', async () => {
        const { testBackendWorkflow } = await import('./backendWorkflows.js');
        const variableId = '6dfba0de-6b09-4f59-8915-1f4822808c92-value';
        const file = new File(['pdf-content'], 'document.pdf', {
            type: 'application/pdf',
            lastModified: 1,
        });

        file.id = 'file-123';
        file.mimeType = file.type;
        variableValues[variableId] = [file];

        await testBackendWorkflow(
            {
                id: '2decfb46-5c48-45a6-9d6b-279aa144b5b8',
                trigger: 'ww-api',
                meta: {
                    method: 'POST',
                    path: '/weweb-storage-file-upload',
                },
                parameters: {
                    file: {
                        name: 'file',
                        type: 'file',
                        multiple: false,
                    },
                },
            },
            { file: variableId },
            { isTest: false },
            {}
        );

        expect(requestWithOptionalSSE).toHaveBeenCalledTimes(1);

        const [{ requestOptions }] = requestWithOptionalSSE.mock.calls[0];

        expect(requestOptions.body).toBeInstanceOf(FormData);
        expect(requestOptions.body.get('fileParam-file')).toBe(file);
    });

    it('resolves bound backend workflow test parameters before sending the request', async () => {
        const { testBackendWorkflow } = await import('./backendWorkflows.js');

        await testBackendWorkflow(
            {
                id: 'dfc24ef3-10de-466a-a279-7ca25f08d630',
                trigger: 'ww-api',
                meta: {
                    method: 'POST',
                    path: '/create-workflow-variable',
                },
                parameters: [
                    {
                        name: 'Text',
                        type: 'array',
                    },
                ],
            },
            { Text: { __wwtype: 'f', code: '["text"]' } },
            { isTest: true },
            {}
        );

        const [{ requestOptions }] = requestWithOptionalSSE.mock.calls[0];

        expect(requestOptions.body).toEqual({
            Text: ['text'],
        });
    });

    it('uses /api and handles SSE for legacy stream requests', async () => {
        const { testBackendWorkflow } = await import('./backendWorkflows.js');

        global.localStorage.getItem = vi.fn(() => 'false');
        global.window = { location: { origin: 'https://example.weweb.io' } };

        await testBackendWorkflow(
            {
                id: 'stream-workflow',
                trigger: 'ww-api',
                meta: {
                    method: 'POST',
                    path: '/stream-workflow',
                },
                parameters: {},
            },
            {},
            { __wwstream: true },
            {}
        );

        const [{ url, stream }] = requestWithOptionalSSE.mock.calls[0];

        expect(url).toBe('https://example.weweb.io//api/stream-workflow');
        expect(stream).toBe(true);
    });
});
