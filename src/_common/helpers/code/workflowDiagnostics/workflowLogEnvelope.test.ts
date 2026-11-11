import { describe, expect, it } from 'vitest';
import {
    WORKFLOW_DIAGNOSTICS_CONTRACT,
    buildPathologicalFixtures,
    containsForbiddenMarker,
    utf8Bytes,
} from '../../../../../../../tests/diagnostics/workflowDiagnosticsContract.mjs';
import { CAPTURE_LIMITS, captureBounded, createNodeBudget } from './boundedCapture';
import { ENVELOPE_LIMITS, encodeWorkflowLogEnvelope, withSenderReport } from './workflowLogEnvelope';
import * as backEnvelope from '../../../../../../weweb-back/core/workflowDiagnostics/workflowLogEnvelope.ts';

const fixtures = buildPathologicalFixtures();
const { envelope: envelopeContract, capture: captureContract } = WORKFLOW_DIAGNOSTICS_CONTRACT;

describe('Back capture mirror', () => {
    it.each(Object.keys(fixtures))('matches the editor capture for %s, including stable IDs', name => {
        const input = { id: '00000000-0000-4000-8000-000000000001', designId: '00000000-0000-4000-8000-000000000002', workflowId: 'workflow', traceId: 'trace', type: 'api', origin: 'back' as const, logs: { action: { result: fixtures[name], error: { name: 'Error', message: 'failed' } } }, context: { parameters: fixtures.wideObject }, errors: [] };
        expect(backEnvelope.encodeWorkflowLogEnvelope(input)).toEqual(encodeWorkflowLogEnvelope(input));
    });
});

function encode(logs: unknown, extra: Partial<Parameters<typeof encodeWorkflowLogEnvelope>[0]> = {}) {
    return encodeWorkflowLogEnvelope({
        designId: '7f1b6c1e-1d3c-4b3a-9c55-7c0ad2a3c111',
        workflowId: 'workflow-id',
        traceId: 'trace-id',
        type: 'global',
        origin: 'front',
        logs,
        context: {},
        errors: [],
        ...extra,
    });
}

describe('bounded workflow diagnostics capture', () => {
    it('matches the shared producer contract', () => {
        expect(ENVELOPE_LIMITS).toMatchObject(envelopeContract);
        expect(CAPTURE_LIMITS).toMatchObject(captureContract);
    });

    it.each(Object.keys(fixtures))('keeps the %s fixture within every envelope bound', name => {
        const encoded = encode({ action: { result: fixtures[name] } });
        const parsed = JSON.parse(encoded.body);

        expect(encoded.bytes).toBe(utf8Bytes(encoded.body));
        expect(encoded.bytes).toBeLessThanOrEqual(envelopeContract.maxBytes);
        expect(parsed.context.diagnostics.nodes).toBeLessThanOrEqual(captureContract.maxNodes);
        expect(parsed.context.diagnostics.truncations.length).toBeLessThanOrEqual(captureContract.maxTruncations);
        for (const entry of parsed.context.diagnostics.truncations) {
            expect(entry.path.length).toBeLessThanOrEqual(captureContract.maxPathLength);
        }
    });

    it.each(Object.keys(fixtures))('reports the exact UTF-8 JSON size of the %s capture', name => {
        const result = captureBounded(fixtures[name], { maxBytes: 40 * 1024, budget: createNodeBudget(4000) });

        expect(result.bytes).toBe(utf8Bytes(JSON.stringify(result.value)));
        expect(result.bytes).toBeLessThanOrEqual(40 * 1024);
    });

    it('reads only a bounded number of properties from a very wide object', () => {
        let reads = 0;
        const wide = new Proxy(fixtures.wideObject, {
            get(target, key, receiver) {
                reads += 1;
                return Reflect.get(target, key, receiver);
            },
        });

        captureBounded(wide, { maxBytes: 40 * 1024, budget: createNodeBudget(4000) });

        expect(reads).toBeLessThan(500);
    });

    it('stops visiting empty containers once the node budget is spent', () => {
        let reads = 0;
        const items = Array.from(
            { length: 100 },
            () =>
                new Proxy(fixtures.emptyContainers, {
                    get(target, key, receiver) {
                        reads += 1;
                        return Reflect.get(target, key, receiver);
                    },
                })
        );
        const budget = createNodeBudget(200);

        const result = captureBounded(items, { maxBytes: 40 * 1024, budget, maxArrayItems: 100 });

        expect(result.nodes).toBeLessThanOrEqual(200);
        expect(budget.remaining).toBe(0);
        expect(reads).toBeLessThan(400);
        expect(result.reasons.maxNodes).toBeGreaterThan(0);
    });

    it('bounds depth without recursing through the whole chain', () => {
        const result = captureBounded(fixtures.deep, { maxBytes: 40 * 1024, budget: createNodeBudget(4000) });
        let depth = 0;
        let cursor = result.value as any;
        while (cursor && typeof cursor === 'object') {
            cursor = cursor.child;
            depth += 1;
        }

        expect(depth).toBeLessThanOrEqual(captureContract.maxDepth);
        expect(result.reasons.maxDepth).toBe(1);
    });

    it('marks cycles, throwing getters and revoked proxies instead of throwing', () => {
        const result = captureBounded(
            { cyclic: fixtures.cyclic, getter: fixtures.throwingGetter, revoked: fixtures.revokedProxy },
            { maxBytes: 40 * 1024, budget: createNodeBudget(4000) }
        );
        const value = result.value as any;

        expect(value.cyclic.self).toBe('[TRUNCATED]');
        expect(value.getter).toEqual({ ok: 'yes', boom: '[TRUNCATED]' });
        expect(value.revoked).toBe('[TRUNCATED]');
        expect(result.reasons.circular).toBeGreaterThan(0);
        expect(result.reasons.unreadable).toBe(2);
    });

    it('does not split surrogate pairs when shortening strings', () => {
        const result = captureBounded(fixtures.unicode, {
            maxBytes: 40 * 1024,
            budget: createNodeBudget(10),
            maxStringBytes: 101,
        });
        const value = result.value as string;

        expect(value.endsWith('...[TRUNCATED]')).toBe(true);
        expect(value.replace('...[TRUNCATED]', '')).toBe(fixtures.unicode.slice(0, value.length - 14));
        expect(utf8Bytes(JSON.stringify(value))).toBeLessThanOrEqual(101);
        expect(JSON.stringify(value)).not.toMatch(/\\ud[89ab]/i);
    });

    it('bounds individual keys and records truncation metadata with capped entries', () => {
        const result = captureBounded(fixtures.escapedKeys, { maxBytes: 40 * 1024, budget: createNodeBudget(4000) });

        for (const key of Object.keys(result.value as object)) {
            expect(utf8Bytes(JSON.stringify(key))).toBeLessThanOrEqual(captureContract.maxKeyBytes);
        }
        expect(result.truncations.length).toBeLessThanOrEqual(captureContract.maxTruncations);
        expect(result.truncationCount).toBeGreaterThan(result.truncations.length);
    });

    it('keeps meaningful errors even when values exhaust their budget', () => {
        const error = new Error('Payment provider refused the charge');
        (error as any).code = 'CARD_DECLINED';
        (error as any).config = { headers: { Authorization: 'Bearer secret-access-token' } };

        const encoded = encode(
            { action1: { result: fixtures.wideArray }, action2: { error: { name: 'FetchError', message: 'boom' } } },
            { errors: [error], context: { parameters: fixtures.wideObject } }
        );
        const parsed = JSON.parse(encoded.body);

        expect(encoded.bytes).toBeLessThanOrEqual(envelopeContract.maxBytes);
        expect(encoded.hasError).toBe(true);
        expect(parsed.hasError).toBe(true);
        expect(parsed.errorSummary).toBe('Error: Payment provider refused the charge');
        expect(parsed.context.errors).toEqual([
            expect.objectContaining({
                name: 'Error',
                message: 'Payment provider refused the charge',
                code: 'CARD_DECLINED',
            }),
            expect.objectContaining({ actionId: 'action2', name: 'FetchError', message: 'boom' }),
        ]);
        expect(containsForbiddenMarker(encoded.body)).toBe(false);
    });

    it('bounds identity fields and always sends object logs', () => {
        const encoded = encode(undefined, {
            workflowId: 'w'.repeat(10_000),
            traceId: 't'.repeat(10_000),
            type: 'x'.repeat(10_000),
        });
        const parsed = JSON.parse(encoded.body);

        expect(parsed.logs).toEqual({});
        expect(parsed.workflowId).toHaveLength(envelopeContract.maxIdentifierLength);
        expect(parsed.traceId).toHaveLength(envelopeContract.maxIdentifierLength);
        expect(parsed.type).toHaveLength(envelopeContract.maxIdentifierLength);
    });

    it('stays within the envelope with escaped identifiers and full sections', () => {
        const control = '\u0001'.repeat(10_000);
        const encoded = encode(
            { action: { result: fixtures.escapedKeys }, other: { error: { name: control, message: control } } },
            {
                designId: control,
                workflowId: control,
                traceId: control,
                type: control,
                errors: [{ name: control, message: control, stack: control }],
                context: { parameters: fixtures.escapedKeys },
            }
        );
        const parsed = JSON.parse(encoded.body);

        expect(encoded.bytes).toBeLessThanOrEqual(envelopeContract.maxBytes);
        expect(parsed.context.errors.length).toBeGreaterThan(0);
        expect(parsed.errorSummary.length).toBeLessThanOrEqual(envelopeContract.maxErrorSummaryLength);
    });

    it('shares one node budget between logs and context', () => {
        const encoded = encode(
            { action: { result: fixtures.emptyContainers } },
            {
                context: { parameters: fixtures.emptyContainers, event: fixtures.wideObject },
            }
        );
        const parsed = JSON.parse(encoded.body);

        expect(parsed.context.diagnostics.nodes).toBeLessThanOrEqual(captureContract.maxNodes);
    });

    it('adds sender omission counts inside the persisted context without exceeding the envelope', () => {
        const encoded = encode({ action: { result: fixtures.largeString } });
        const annotated = withSenderReport(encoded.body, { dropped: 3, droppedErrors: 1, failed: 2, failedErrors: 0 });

        expect(JSON.parse(annotated).context.diagnostics.sender).toEqual({
            dropped: 3,
            droppedErrors: 1,
            failed: 2,
            failedErrors: 0,
        });
        expect(utf8Bytes(annotated)).toBeLessThanOrEqual(envelopeContract.maxBytes);
    });
});
