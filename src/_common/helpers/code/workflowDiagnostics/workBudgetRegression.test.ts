import { describe, it, expect } from 'vitest';
import { captureBounded, createNodeBudget } from './boundedCapture';

describe('capture work budget includes skipped values', () => {
    it('stops inspecting enumerable undefined values when the work budget is exhausted', () => {
        const source: Record<string, unknown> = {};
        for (let i = 0; i < 10000; i++) source[`key${i}`] = undefined;
        let reads = 0;
        const input = new Proxy(source, {
            get(target, key) {
                reads++;
                return target[key as string];
            },
        });
        captureBounded(input, { maxBytes: 1024, budget: createNodeBudget(100) });
        expect(reads).toBeLessThanOrEqual(100);
    });
});

it('enumerates each distinct container only once even when many actions share a wide result', () => {
    const source: Record<string, unknown> = {};
    for (let i = 0; i < 20000; i++) source[`key${i}`] = i;
    let enumerations = 0;
    const input = new Proxy(source, { ownKeys(target) { enumerations++; return Reflect.ownKeys(target); } });
    const repeated = Array.from({ length: 50 }, () => input);
    captureBounded(repeated, { maxBytes: 64000, budget: createNodeBudget(4000) });
    expect(enumerations).toBe(1);
});

it('charges inherited enumerable keys to the aggregate work budget', () => {
    const prototype: Record<string, unknown> = {};
    for (let i = 0; i < 10000; i++) prototype[`key${i}`] = i;
    let inspected = 0;
    const input = new Proxy(Object.create(prototype), { getOwnPropertyDescriptor(target, key) { inspected++; return Reflect.getOwnPropertyDescriptor(target, key); } });
    const result = captureBounded(input, { maxBytes: 1024, budget: createNodeBudget(100) });
    // V8 iteration and Object.hasOwn each inspect a descriptor. Both stay bounded.
    expect(inspected).toBeLessThanOrEqual(201);
    expect(result.reasons.maxNodes).toBeGreaterThan(0);
});

it('reserves useful context for a realistic multi-action result', async () => {
    const { encodeWorkflowLogEnvelope } = await import('./workflowLogEnvelope');
    const logs: Record<string, unknown> = {};
    for (let i = 0; i < 12; i++) logs[`action${i}`] = { result: Array.from({ length: 20 }, () => Object.fromEntries(Array.from({ length: 12 }, (_, j) => [`field${j}`, 'value']))) };
    const entry = JSON.parse(encodeWorkflowLogEnvelope({ designId: 'project', workflowId: 'workflow', traceId: 'trace', type: 'workflow', origin: 'front', logs, context: { parameters: { query: 'shoes' } }, errors: [] }).body);
    expect(entry.context.parameters).toEqual({ query: 'shoes' });
    expect(entry.context.diagnostics.nodes).toBeLessThanOrEqual(4000);
});

it('normalizes PostgreSQL-incompatible text in values, keys and truncated paths', async () => {
    const { encodeWorkflowLogEnvelope } = await import('./workflowLogEnvelope');
    const logs = { 'nul\u0000key': 'x\u0000y\ud800a', ['c'.repeat(100)]: { ['d'.repeat(46) + '😀'.repeat(100)]: 'x'.repeat(2000) } };
    const entry = encodeWorkflowLogEnvelope({ designId: 'project', workflowId: 'workflow', traceId: 'trace', type: 'workflow', origin: 'front', logs, context: {}, errors: [] });
    expect(entry.body).not.toMatch(/\\u0000|\\ud[89ab][0-9a-f]{2}/i);
    expect(JSON.parse(entry.body).logs['nul␀key']).toBe('x␀y�a');
    expect(Buffer.byteLength(entry.body)).toBe(entry.bytes);
});
