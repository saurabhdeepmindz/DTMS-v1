import { beforeEach, describe, expect, it, vi } from 'vitest';

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

import api from '@/_manager/services/newApi';
import * as workflowTracking from './workflowTracking.js';

// Optional access keeps this suite meaningful against the pre-WW-6080 module shape.
const { resetWorkflowLogSenderForTests, workflowLogSenderStats } = workflowTracking;
import {
    WORKFLOW_DIAGNOSTICS_CONTRACT,
    buildPathologicalFixtures,
    containsForbiddenMarker,
    utf8Bytes,
} from '../../../../../../tests/diagnostics/workflowDiagnosticsContract.mjs';

const DESIGN_ID = '7f1b6c1e-1d3c-4b3a-9c55-7c0ad2a3c111';
const fixtures = buildPathologicalFixtures();

function returnWorkflow(id = 'workflow-diagnostics') {
    return {
        id,
        firstAction: 'return-action',
        actions: {
            'return-action': { id: 'return-action', type: 'return', value: 'business-result' },
        },
    };
}

describe('executeWorkflow remote diagnostics', () => {
    let workflowResults;
    let saveWorkflowLogs;

    beforeEach(() => {
        globalThis.FileList = class FileList {};
        workflowResults = {};
        saveWorkflowLogs = vi.fn((_target, body) => Promise.resolve({ version: 2, accepted: JSON.parse(body).entries.map(entry => entry.id) }));
        api.projects = { saveWorkflowLogBatch: saveWorkflowLogs };
        resetWorkflowLogSenderForTests?.();
        globalThis.wwLib = {
            WW_SAFE_MODE_HARD: 'hard',
            $pinia: {},
            store: {
                manager: { safeMode: null, setWorkflowLoadingStatus: vi.fn(), setWorkflowActionLoadingStatus: vi.fn() },
                websiteData: { designInfo: { id: DESIGN_ID } },
                data: {
                    workflowResultsById: new Proxy({}, { get: () => workflowResults }),
                    formulas: {}, pluginFormulas: {}, collections: {},
                    resetWorkflowResult: vi.fn(), setWorkflowActionResult: vi.fn(), setWorkflowError: vi.fn(),
                },
                libraries: { components: {} },
                debugger: { startWorkflow: vi.fn(() => 'execution-id'), stopWorkflow: vi.fn(), log: vi.fn() },
                integrations: { getCodeBindings: () => ({}) },
            },
            globalVariables: { customCodeVariables: {} },
            wwVariable: { updateValue: vi.fn((_, value) => value) },
        };
    });

    it('persists one bounded encoded envelope without the raw workflow context', async () => {
        workflowResults = {
            'return-action': { result: fixtures.wideArray },
            huge: { result: fixtures.wideObject },
            cyclic: { result: fixtures.cyclic },
            text: { result: fixtures.unicode },
        };
        const context = {
            parameters: { email: 'user@example.com' },
            component: { token: 'secret-session-token', props: fixtures.wideObject },
            auth: { password: 'secret-password' },
        };

        const execution = await executeWorkflow(returnWorkflow(), { context });

        expect(execution).toEqual({ error: undefined, result: 'business-result' });
        await workflowTracking.flushWorkflowLogs({ timeoutMs: 50 });
        expect(saveWorkflowLogs).toHaveBeenCalledTimes(1);
        const [designId, body, options] = saveWorkflowLogs.mock.calls[0];
        expect(designId).toBe(DESIGN_ID);
        expect(typeof body).toBe('string');
        expect(utf8Bytes(body)).toBeLessThanOrEqual(WORKFLOW_DIAGNOSTICS_CONTRACT.storedSender.maxBatchBytes);
        expect(options.signal).toBeInstanceOf(globalThis.AbortSignal);
        expect(containsForbiddenMarker(body)).toBe(false);

        const parsed = JSON.parse(body).entries[0];
        expect(parsed).toMatchObject({
            designId: DESIGN_ID,
            workflowId: 'workflow-diagnostics',
            traceId: context.traceId,
            type: 'global',
            origin: 'front',
            hasError: false,
        });
        expect(parsed.context.parameters).toEqual({ email: 'user@example.com' });
        expect(parsed.context.component).toBeUndefined();
        expect(parsed.context.diagnostics.truncationCount).toBeGreaterThan(0);
    });

    it('keeps the local debugger results untouched', async () => {
        const result = { rows: Array.from({ length: 1000 }, (_, i) => ({ i })) };
        workflowResults = { 'return-action': { result } };

        await executeWorkflow(returnWorkflow(), {});

        expect(workflowResults['return-action'].result).toBe(result);
        expect(result.rows).toHaveLength(1000);
    });

    it('does not let a rejected log request reach the business result or unhandled rejections', async () => {
        const unhandled = vi.fn();
        process.on('unhandledRejection', unhandled);
        try {
            saveWorkflowLogs.mockImplementation(() => Promise.reject(new Error('Back unavailable')));

            const execution = await executeWorkflow(returnWorkflow(), {});
            await new Promise(resolve => setTimeout(resolve, 10));

            expect(execution).toEqual({ error: undefined, result: 'business-result' });
            await workflowTracking.flushWorkflowLogs({ timeoutMs: 50 });
        expect(saveWorkflowLogs).toHaveBeenCalledTimes(1);
            expect(workflowLogSenderStats?.()).toMatchObject({ failures: 1, pending: 1, inFlight: false });
            expect(unhandled).not.toHaveBeenCalled();
        } finally {
            process.off('unhandledRejection', unhandled);
        }
    });

    it('does not let a capture failure alter the business result', async () => {
        workflowResults = new Proxy(
            {},
            {
                ownKeys() {
                    throw new Error('hostile results');
                },
            }
        );

        const execution = await executeWorkflow(returnWorkflow(), {});

        expect(execution).toEqual({ error: undefined, result: 'business-result' });
    });

    it('persists workflow errors with a reserved error budget', async () => {
        workflowResults = { 'return-action': { result: fixtures.wideArray } };
        const workflow = {
            id: 'workflow-error',
            version: 2,
            firstAction: 'return-action',
            actions: {
                'return-action': {
                    id: 'return-action',
                    type: 'return',
                    value: { __wwtype: 'f', code: 'missing.value' },
                },
            },
        };

        const execution = await executeWorkflow(workflow, {});

        expect(execution.error).toMatchObject({ name: 'FormulaError' });
        await workflowTracking.flushWorkflowLogs({ timeoutMs: 50 });
        const parsed = JSON.parse(saveWorkflowLogs.mock.calls[0][1]).entries[0];
        expect(parsed.hasError).toBe(true);
        expect(parsed.context.isError).toBe(true);
        expect(parsed.errorSummary).toMatch(/^FormulaError: /);
        expect(parsed.context.errors[0]).toMatchObject({ name: 'FormulaError' });
    });
});
