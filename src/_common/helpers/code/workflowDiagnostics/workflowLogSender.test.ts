import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWorkflowLogSender, WORKFLOW_LOG_SENDER_LIMITS, readWorkflowLogAcknowledgement } from './workflowLogSender';
import { createWorkflowLogSender as createLambdaSender, WORKFLOW_LOG_SENDER_LIMITS as lambdaLimits } from '../../../../../../weweb-lambda-back-publisher/server/src/services/workflowDiagnostics/workflowLogSender.ts';
import { WORKFLOW_DIAGNOSTICS_CONTRACT } from '../../../../../../../tests/diagnostics/workflowDiagnosticsContract.mjs';

const project = '00000000-0000-4000-8000-000000000001';
const otherProject = '00000000-0000-4000-8000-000000000002';
function item(n: number, extra = {}) {
    const id = `00000000-0000-4000-8001-${n.toString().padStart(12, '0')}`;
    return { id, target: project, body: JSON.stringify({ id, value: n }), ...extra };
}
async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); }
function transport() {
    const calls: any[] = [];
    return { calls, send: vi.fn((batch, { signal }) => new Promise((resolve, reject) => {
        calls.push({ batch, signal, resolve, reject });
    })) };
}
function acknowledge(call: any) { call.resolve({ version: 2, accepted: call.batch.ids }); }

describe.each([
    ['editor', createWorkflowLogSender, WORKFLOW_LOG_SENDER_LIMITS],
    ['Lambda', createLambdaSender, lambdaLimits],
])('%s acknowledged workflow log sender', (_name, create, limits) => {
    const senders: any[] = [];
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => { for (const sender of senders.splice(0)) sender.stop(); vi.useRealTimers(); });
    function sender(send: any, overrides = {}) {
        const result = create({ transport: send, limits: overrides });
        senders.push(result);
        return result;
    }
    it('matches the shared stored-log contract', () => {
        expect(limits).toEqual(WORKFLOW_DIAGNOSTICS_CONTRACT.storedSender);
    });
    it('batches interval traffic and retains all records until storage acknowledgement', async () => {
        const wire = transport();
        const queue = sender(wire.send);
        for (let i = 1; i <= 10; i++) expect(queue.enqueue(item(i))).toBe(true);
        await vi.advanceTimersByTimeAsync(249);
        expect(wire.calls).toHaveLength(0);
        await vi.advanceTimersByTimeAsync(1);
        expect(wire.calls).toHaveLength(1);
        expect(JSON.parse(wire.calls[0].batch.body).entries).toHaveLength(10);
        expect(queue.getStats().pending).toBe(10);
        acknowledge(wire.calls[0]);
        await settle();
        expect(queue.getStats()).toMatchObject({ pending: 0, sent: 10, rejected: 0 });
    });
    it('splits batches by actual UTF-8 bytes and flushes errors immediately', async () => {
        const wire = transport();
        const queue = sender(wire.send);
        for (let i = 1; i <= 5; i++) {
            const entry = item(i);
            entry.body = JSON.stringify({ id: entry.id, value: 'é'.repeat(20000) });
            expect(queue.enqueue(entry)).toBe(true);
        }
        const flushed = queue.flush();
        await settle();
        for (let i = 0; i < 2; i++) {
            expect(Buffer.byteLength(wire.calls[i].batch.body)).toBeLessThanOrEqual(limits.maxBatchBytes);
            acknowledge(wire.calls[i]);
            await settle();
        }
        await expect(flushed).resolves.toMatchObject({ acknowledged: true, sent: 5 });
        queue.enqueue(item(6, { isError: true }));
        await settle();
        expect(wire.calls).toHaveLength(3);
    });
    it('never mixes projects or credentials in a batch', async () => {
        const wire = transport();
        const queue = sender(wire.send);
        queue.enqueue(item(1, { credential: 'first' }));
        queue.enqueue(item(2, { credential: 'second' }));
        queue.enqueue(item(3, { target: otherProject, credential: 'first' }));
        queue.enqueue(item(4, { credential: 'first' }));
        const flushed = queue.flush();
        await settle();
        expect(wire.calls[0].batch.ids).toEqual([item(1).id, item(4).id]);
        acknowledge(wire.calls[0]); await settle();
        expect(wire.calls[1].batch.credential).toBe('second');
        acknowledge(wire.calls[1]); await settle();
        expect(wire.calls[2].batch.target).toBe(otherProject);
        acknowledge(wire.calls[2]); await settle();
        await expect(flushed).resolves.toHaveProperty('acknowledged', true);
    });
    it('retains a failed upload and retries the exact same immutable IDs/body', async () => {
        const wire = transport();
        const queue = sender(wire.send);
        queue.enqueue(item(1)); queue.enqueue(item(2));
        await vi.advanceTimersByTimeAsync(250);
        wire.calls[0].reject(new Error('lost acknowledgement after DB commit'));
        await settle();
        expect(queue.getStats().pending).toBe(2);
        await vi.advanceTimersByTimeAsync(500);
        expect(wire.calls[1].batch.body).toBe(wire.calls[0].batch.body);
        expect(wire.calls[0].batch.isRetry).toBe(false);
        expect(wire.calls[1].batch.isRetry).toBe(true);
        acknowledge(wire.calls[1]); await settle();
        expect(queue.getStats()).toMatchObject({ pending: 0, sent: 2, failures: 1 });
    });
    it.each([401, 403, 409, 'WORKFLOW_LOG_AUTH_CHANGED'])('releases permanently rejected records (%s) so later records can be stored', async reason => {
        const wire = transport();
        const queue = sender(wire.send, { maxBufferedRecords: 1 });
        queue.enqueue(item(1, { isError: true })); await settle();
        const flushed = queue.flush();
        wire.calls[0].reject(Object.assign(new Error('permanent'), typeof reason === 'number' ? { status: reason } : { code: reason }));
        await settle();
        await expect(flushed).resolves.toMatchObject({ acknowledged: false, pending: 0, abandoned: 1, abandonedErrors: 1 });
        expect(queue.enqueue(item(2))).toBe(true); await vi.advanceTimersByTimeAsync(250);
        acknowledge(wire.calls[1]); await settle();
        expect(queue.getStats()).toMatchObject({ pending: 0, sent: 1, abandoned: 1 });
    });
    it('gates new records and repeated lifecycle flushes behind the same outage backoff', async () => {
        const wire = transport();
        const queue = sender(wire.send);
        queue.enqueue(item(1, { isError: true })); await settle();
        wire.calls[0].reject(Object.assign(new Error('overload'), { status: 429, retryAfterMs: 2000 })); await settle();
        for (let i = 2; i <= 40; i++) queue.enqueue(item(i, { isError: true }));
        for (let i = 0; i < 5; i++) await expect(queue.flush({ timeoutMs: 100 })).resolves.toMatchObject({ acknowledged: false });
        expect(wire.calls).toHaveLength(1);
        await vi.advanceTimersByTimeAsync(1999);
        expect(wire.calls).toHaveLength(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(wire.calls).toHaveLength(2);
        expect(wire.calls[1].batch.ids).toHaveLength(32);
    });
    it('reports each omission once after acknowledgement and keeps attempted reports immutable across retries', async () => {
        const wire = transport();
        const queue = create({
            transport: wire.send,
            annotate: (body, report) => JSON.stringify({ ...JSON.parse(body), report }),
            limits: { maxBufferedRecords: 2 },
        });
        senders.push(queue);
        queue.enqueue(item(1, { isError: true })); await settle();
        queue.enqueue(item(2));
        expect(queue.enqueue(item(3))).toBe(false);
        acknowledge(wire.calls[0]); await settle();
        await vi.advanceTimersByTimeAsync(250);
        expect(JSON.parse(wire.calls[1].batch.body).entries[0].report.dropped).toBe(1);
        queue.enqueue(item(4));
        expect(queue.enqueue(item(5))).toBe(false);
        wire.calls[1].reject(new Error('lost ACK')); await settle();
        await vi.advanceTimersByTimeAsync(500);
        const retry = JSON.parse(wire.calls[2].batch.body).entries;
        expect(JSON.stringify(retry[0])).toBe(JSON.stringify(JSON.parse(wire.calls[1].batch.body).entries[0]));
        expect(retry[1].report).toBeUndefined();
        acknowledge(wire.calls[2]); await settle();
        queue.enqueue(item(6)); await vi.advanceTimersByTimeAsync(250);
        expect(JSON.parse(wire.calls[3].batch.body).entries[0].report.dropped).toBe(1);
        acknowledge(wire.calls[3]); await settle();
        queue.enqueue(item(7)); await vi.advanceTimersByTimeAsync(250);
        expect(JSON.parse(wire.calls[4].batch.body).entries[0].report).toBeUndefined();
    });
    it('carries permanently failed counts onto a later stored record', async () => {
        const wire = transport();
        const queue = create({ transport: wire.send, annotate: (body, report) => JSON.stringify({ ...JSON.parse(body), report }) });
        senders.push(queue);
        queue.enqueue(item(1, { isError: true })); await settle();
        wire.calls[0].reject(Object.assign(new Error('denied'), { status: 403 })); await settle();
        queue.enqueue(item(2)); await vi.advanceTimersByTimeAsync(250);
        expect(JSON.parse(wire.calls[1].batch.body).entries[0].report).toEqual({ dropped: 0, droppedErrors: 0, failed: 1, failedErrors: 1 });
        acknowledge(wire.calls[1]); await settle();
        queue.enqueue(item(3)); await vi.advanceTimersByTimeAsync(250);
        expect(JSON.parse(wire.calls[2].batch.body).entries[0].report).toBeUndefined();
    });
    it.each([undefined, { version: 2, accepted: [] }, { version: 2, accepted: ['wrong'] }])('does not release records for an invalid or partial ACK (%j)', async ack => {
        const wire = transport();
        const queue = sender(wire.send);
        queue.enqueue(item(1));
        await vi.advanceTimersByTimeAsync(250);
        wire.calls[0].resolve(ack); await settle();
        expect(queue.getStats()).toMatchObject({ pending: 1, sent: 0, failures: 1 });
    });
    it('reports admission overflow without evicting already accepted records, including in-flight records', async () => {
        const wire = transport();
        const queue = sender(wire.send, { maxBufferedRecords: 2 });
        expect(queue.enqueue(item(1, { isError: true }))).toBe(true);
        await settle();
        expect(queue.enqueue(item(2))).toBe(true);
        expect(queue.enqueue(item(3, { isError: true }))).toBe(false);
        expect(queue.getStats()).toMatchObject({ pending: 2, rejected: 1, rejectedErrors: 1 });
        acknowledge(wire.calls[0]); await settle();
        await vi.advanceTimersByTimeAsync(250);
        expect(wire.calls[1].batch.ids).toEqual([item(2).id]);
    });
    it('charges credentials and rejects oversized UTF-8 bodies before queue admission', () => {
        const queue = sender(vi.fn(), { maxBufferedBytes: 100 });
        expect(queue.enqueue(item(1, { credential: 'x'.repeat(80) }))).toBe(false);
        const entry = item(2);
        entry.body = JSON.stringify({ id: entry.id, value: 'é'.repeat(40000) });
        expect(queue.enqueue(entry)).toBe(false);
        expect(queue.getStats()).toMatchObject({ pending: 0, pendingBytes: 0, rejected: 2 });
    });
    it.each(['€', '\n', '\r', 'a;b', 'a,b', '"a"', 'a\\b'])('rejects decoded invalid cookie credentials (%j) without poisoning later uploads', async credential => {
        const wire = transport();
        const queue = sender(wire.send);
        expect(queue.enqueue(item(1, { credential }))).toBe(false);
        queue.enqueue(item(2, { credential: 'valid.token-_=', isError: true })); await settle();
        acknowledge(wire.calls[0]); await settle();
        expect(queue.getStats()).toMatchObject({ pending: 0, failures: 0, sent: 1, rejected: 1 });
    });
    it('keeps one physical upload even if its transport ignores abort, and rejects late ACKs', async () => {
        const wire = transport();
        const queue = sender(wire.send, { timeoutMs: 20 });
        queue.enqueue(item(1, { isError: true })); await settle();
        await vi.advanceTimersByTimeAsync(1000);
        expect(wire.calls[0].signal.aborted).toBe(true);
        expect(wire.calls).toHaveLength(1);
        acknowledge(wire.calls[0]); await settle();
        expect(queue.getStats().pending).toBe(1);
        await vi.advanceTimersByTimeAsync(500);
        acknowledge(wire.calls[1]); await settle();
        expect(queue.getStats().pending).toBe(0);
    });
    it('bounds completion flush time and shares one completion promise', async () => {
        const wire = transport();
        const queue = sender(wire.send);
        queue.enqueue(item(1));
        const flushed = queue.flush({ timeoutMs: 20 });
        expect(queue.flush()).toBe(flushed);
        await vi.advanceTimersByTimeAsync(20);
        await expect(flushed).resolves.toMatchObject({ acknowledged: false, pending: 1 });
        expect(wire.calls[0].signal.aborted).toBe(false);
        await expect(queue.flush({ timeoutMs: 0 })).resolves.toMatchObject({ acknowledged: false });
        const secondFlush = queue.flush({ timeoutMs: 20 });
        await vi.advanceTimersByTimeAsync(20);
        await expect(secondFlush).resolves.toMatchObject({ acknowledged: false });
        expect(wire.calls).toHaveLength(1);
        expect(wire.calls[0].signal.aborted).toBe(false);
        acknowledge(wire.calls[0]); await settle();
        expect(queue.getStats()).toMatchObject({ pending: 0, sent: 1, failures: 0 });
    });
    it('flushes the captured watermark without starting later records before returning', async () => {
        const wire = transport();
        const queue = sender(wire.send);
        queue.enqueue(item(1));
        const flushed = queue.flush(); await settle();
        queue.enqueue(item(2));
        acknowledge(wire.calls[0]); await settle();
        await expect(flushed).resolves.toMatchObject({ acknowledged: true, pending: 1, inFlight: false });
        expect(wire.calls).toHaveLength(1);
        await vi.advanceTimersByTimeAsync(250);
        expect(wire.calls[1].batch.ids).toEqual([item(2).id]);
    });
});

describe('small storage acknowledgements', () => {
    it('accepts an ACK at the exact decoded byte boundary', async () => {
        const body = JSON.stringify({ version: 2, accepted: [item(1).id] });
        expect(await readWorkflowLogAcknowledgement(new Response(body.padEnd(4096)))).toEqual(JSON.parse(body));
    });
    it('cancels oversized acknowledgements and HTTP error bodies', async () => {
        await expect(readWorkflowLogAcknowledgement(new Response('x'.repeat(4097)))).rejects.toThrow('ACK_TOO_LARGE');
        const response = new Response('x'.repeat(100000), { status: 503 });
        const cancel = vi.spyOn(response.body!, 'cancel');
        await expect(readWorkflowLogAcknowledgement(response)).rejects.toThrow('HTTP_ERROR');
        expect(cancel).toHaveBeenCalledOnce();
    });
});
