import { utf8ByteLength } from './boundedCapture.ts';

// Stored records remain queued until acknowledgement or permanent rejection.
// There is no eviction under pressure; hard overflow is reported to the producer.
export const WORKFLOW_LOG_SENDER_LIMITS = Object.freeze({
    flushIntervalMs: 250,
    maxBufferedRecords: 256,
    maxBufferedBytes: 4 * 1024 * 1024,
    maxEntryBytes: 64 * 1024,
    maxBatchRecords: 32,
    maxBatchBytes: 128 * 1024,
    timeoutMs: 10000,
    flushTimeoutMs: 5000,
    retryDelayMs: 500,
    maxRetryDelayMs: 30000,
});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// RFC 6265 cookie-octet: exclude decoded controls, Unicode and delimiters.
const COOKIE_VALUE = /^[\x21\x23-\x2B\x2D-\x3A\x3C-\x5B\x5D-\x7E]*$/;
const PREFIX = '{"version":2,"entries":[';
const SUFFIX = ']}';

export type WorkflowLogItem = { id: string; target: string; body: string; credential?: string; authKey?: string; isError?: boolean };
export type WorkflowLogBatch = { target: string; credential: string; authKey: string; body: string; ids: string[]; isRetry: boolean };
type Report = { dropped: number; droppedErrors: number; failed: number; failedErrors: number };
type Entry = WorkflowLogItem & { credential: string; authKey: string; bytes: number; charge: number; sequence: number; attempted: boolean; report?: Report };
type Options = {
    transport: (batch: WorkflowLogBatch, options: { signal: AbortSignal }) => Promise<unknown>;
    annotate?: (body: string, report: { dropped: number; droppedErrors: number; failed: number; failedErrors: number }) => string;
    limits?: Partial<{ [K in keyof typeof WORKFLOW_LOG_SENDER_LIMITS]: number }>;
};

export function createWorkflowLogSender({ transport, annotate = undefined, limits: overrides = {} }: Options) {
    const limits = { ...WORKFLOW_LOG_SENDER_LIMITS, ...overrides };
    for (const key in limits) {
        const value = limits[key as keyof typeof limits];
        if (!Number.isSafeInteger(value) || value <= 0 || value > 2147483647) throw new Error('INVALID_WORKFLOW_LOG_SENDER_LIMIT');
    }
    let queue: Entry[] = [];
    let bufferedBytes = 0;
    let sequence = 0;
    let sent = 0;
    let rejected = 0;
    let rejectedErrors = 0;
    let failures = 0;
    let abandoned = 0;
    let abandonedErrors = 0;
    let failedSinceFlush = 0;
    let consecutiveFailures = 0;
    let notBefore = 0;
    const unreported: Report = { dropped: 0, droppedErrors: 0, failed: 0, failedErrors: 0 };
    let reporting: Entry | null = null;
    let closed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let active: { controller: AbortController; cancelled: boolean } | null = null;
    let flushing: { watermark: number; deadline: number; promise: Promise<any>; resolve: (result: any) => void; timer: ReturnType<typeof setTimeout> } | null = null;

    function getStats() {
        return { pending: queue.length, pendingBytes: bufferedBytes, inFlight: !!active, sent, rejected, rejectedErrors, failures, abandoned, abandonedErrors };
    }
    function clearTimer() {
        clearTimeout(timer);
        timer = undefined;
    }
    function finishFlush() {
        if (!flushing) return;
        const state = flushing;
        flushing = null;
        clearTimeout(state.timer);
        state.resolve({ acknowledged: !failedSinceFlush && !queue.some(entry => entry.sequence <= state.watermark), ...getStats() });
        failedSinceFlush = 0;
    }
    function schedule(delay = limits.flushIntervalMs) {
        clearTimer();
        if (closed || active || !queue.length) return;
        timer = setTimeout(pump, Math.max(1, delay));
        (timer as any).unref?.();
    }
    function reject(item: WorkflowLogItem) {
        rejected++;
        unreported.dropped++;
        if (item?.isError) rejectedErrors++;
        if (item?.isError) unreported.droppedErrors++;
        return false;
    }
    function enqueue(item: WorkflowLogItem): boolean {
        try {
            if (closed || typeof item.id !== 'string' || typeof item.target !== 'string' || !UUID.test(item.id) || !UUID.test(item.target) || typeof item.body !== 'string' ||
                (item.credential != null && typeof item.credential !== 'string') || (item.authKey != null && typeof item.authKey !== 'string') ||
                item.body.length > limits.maxEntryBytes || (item.credential?.length ?? 0) > 8192 || (item.authKey?.length ?? 0) > 255) return reject(item);
            const body = item.body;
            const bytes = utf8ByteLength(body);
            if (bytes > limits.maxEntryBytes || JSON.parse(body).id !== item.id) return reject(item);
            const credential = item.credential || '';
            const authKey = item.authKey || '';
            if (!COOKIE_VALUE.test(credential)) return reject(item);
            const existing = queue.find(entry => entry.id === item.id);
            if (existing) return existing.body === body && existing.target === item.target && existing.credential === credential && existing.authKey === authKey ? true : reject(item);
            // Reserve room for one bounded omission report before the first attempt.
            const charge = bytes + 256 + utf8ByteLength(credential) + utf8ByteLength(authKey) + item.target.length + item.id.length;
            if (queue.length >= limits.maxBufferedRecords || bufferedBytes + charge > limits.maxBufferedBytes || bytes + PREFIX.length + SUFFIX.length > limits.maxBatchBytes) return reject(item);
            queue.push({ id: item.id, target: item.target, credential, authKey, body, bytes, charge, isError: item.isError === true, sequence: ++sequence, attempted: false });
            bufferedBytes += charge;
            if (item.isError || bufferedBytes >= limits.maxBatchBytes || queue.length >= limits.maxBatchRecords || flushing) {
                clearTimer();
                pump();
            } else if (!timer) schedule();
            return true;
        } catch {
            return reject(item);
        }
    }
    function pump() {
        clearTimer();
        if (closed || active) return;
        if (flushing && !queue.some(entry => entry.sequence <= flushing!.watermark)) {
            finishFlush();
            schedule();
            return;
        }
        if (Date.now() < notBefore) {
            // Lifecycle flushes and newly admitted records obey the same backoff.
            if (flushing && notBefore >= flushing.deadline) finishFlush();
            schedule(notBefore - Date.now());
            return;
        }
        const candidates = queue.filter(entry => !flushing || entry.sequence <= flushing.watermark);
        const first = candidates[0];
        if (!first) return;
        if (annotate && !reporting && Object.values(unreported).some(value => value > 0)) {
            const entry = candidates.find(entry => !entry.attempted && entry.target === first.target && entry.credential === first.credential && entry.authKey === first.authKey);
            if (entry) {
                try {
                    const report = { ...unreported };
                    const body = annotate(entry.body, report);
                    const bytes = utf8ByteLength(body);
                    if (body !== entry.body && bytes <= limits.maxEntryBytes && bytes <= entry.bytes + 256 && bytes + PREFIX.length + SUFFIX.length <= limits.maxBatchBytes) {
                        entry.body = body;
                        entry.bytes = bytes;
                        entry.report = report;
                        reporting = entry;
                    }
                } catch { /* Reporting cannot alter delivery or execution. */ }
            }
        }
        const entries: Entry[] = [];
        let bytes = PREFIX.length + SUFFIX.length;
        for (const entry of candidates) {
            if (entry.target !== first.target || entry.credential !== first.credential || entry.authKey !== first.authKey) continue;
            const added = entry.bytes + (entries.length ? 1 : 0);
            if (entries.length >= limits.maxBatchRecords || bytes + added > limits.maxBatchBytes) break;
            entries.push(entry);
            bytes += added;
        }
        const controller = new AbortController();
        const isRetry = entries.some(entry => entry.attempted);
        for (const entry of entries) entry.attempted = true;
        const attempt = { controller, cancelled: false };
        active = attempt;
        const timeout = setTimeout(() => { attempt.cancelled = true; controller.abort(); }, limits.timeoutMs);
        (timeout as any).unref?.();
        const batch = { target: first.target, credential: first.credential, authKey: first.authKey, body: PREFIX + entries.map(entry => entry.body).join(',') + SUFFIX, ids: entries.map(entry => entry.id), isRetry };
        // Keep the physical transport active until it settles, even after abort.
        // A transport ignoring cancellation cannot spawn unlimited requests.
        Promise.resolve().then(() => transport(batch, { signal: controller.signal })).then(ack => {
            const response = ack as { version?: number; accepted?: unknown[] };
            if (attempt.cancelled || response?.version !== 2 || !Array.isArray(response.accepted) || response.accepted.length !== entries.length ||
                new Set(response.accepted).size !== entries.length || !entries.every(entry => response.accepted!.includes(entry.id))) throw new Error('WORKFLOW_LOG_BATCH_NOT_ACKNOWLEDGED');
            const acknowledged = new Set(entries);
            queue = queue.filter(entry => !acknowledged.has(entry));
            for (const entry of entries) bufferedBytes -= entry.charge;
            if (reporting?.report && acknowledged.has(reporting)) {
                const report = reporting.report;
                for (const key in report) unreported[key as keyof Report] -= report[key as keyof Report];
                reporting = null;
            }
            sent += entries.length;
            consecutiveFailures = 0;
            notBefore = 0;
        }).catch(error => {
            failures++;
            controller.abort();
            const status = error?.status ?? error?.response?.status;
            const permanent = error?.retryable === false || error?.code === 'WORKFLOW_LOG_AUTH_CHANGED' ||
                (Number.isInteger(status) && status >= 300 && status < 500 && status !== 408 && status !== 429);
            if (permanent) {
                const rejectedEntries = new Set(entries);
                queue = queue.filter(entry => !rejectedEntries.has(entry));
                for (const entry of entries) {
                    bufferedBytes -= entry.charge;
                    abandoned++;
                    unreported.failed++;
                    if (entry.isError) { abandonedErrors++; unreported.failedErrors++; }
                }
                failedSinceFlush += entries.length;
                if (reporting && rejectedEntries.has(reporting)) reporting = null;
                consecutiveFailures = 0;
                notBefore = 0;
            } else {
                consecutiveFailures = Math.min(consecutiveFailures + 1, 16);
                const retryAfter = error?.retryAfterMs ?? Number(error?.response?.headers?.['retry-after']) * 1000;
                const delay = Math.min(limits.maxRetryDelayMs, Math.max(limits.retryDelayMs * 2 ** (consecutiveFailures - 1), Number.isFinite(retryAfter) ? retryAfter : 0));
                notBefore = Date.now() + delay;
            }
        }).finally(() => {
            clearTimeout(timeout);
            if (active === attempt) active = null;
            if (closed) return;
            if (flushing || bufferedBytes >= limits.maxBatchBytes || queue.length >= limits.maxBatchRecords) pump();
            else schedule(Date.now() < notBefore ? notBefore - Date.now() : limits.flushIntervalMs);
        });
    }
    /** @param {{ timeoutMs?: number }} [options] */
    function flush({ timeoutMs = limits.flushTimeoutMs }: { timeoutMs?: number } = {}): Promise<any> {
        if (flushing) return flushing.promise;
        timeoutMs = Number.isFinite(timeoutMs) ? Math.max(0, Math.min(limits.flushTimeoutMs, timeoutMs)) : 0;
        if (!queue.length || closed || timeoutMs <= 0) {
            const result = { acknowledged: !failedSinceFlush && !queue.length, ...getStats() };
            failedSinceFlush = 0;
            return Promise.resolve(result);
        }
        const watermark = sequence;
        let resolve!: (result: any) => void;
        const promise = new Promise(result => { resolve = result; });
        // A lifecycle budget stops waiting, not an otherwise healthy upload.
        // Only the independent per-attempt deadline cancels the transport.
        const deadline = setTimeout(finishFlush, timeoutMs);
        flushing = { watermark, deadline: Date.now() + timeoutMs, promise, resolve, timer: deadline };
        pump();
        return promise;
    }
    function stop() {
        closed = true;
        clearTimer();
        if (active) { active.cancelled = true; active.controller.abort(); }
        finishFlush();
    }
    return { enqueue, flush, getStats, stop };
}

// Lambda's fetch transport reads only this small acknowledgement, never an
// echoed log record or an arbitrary HTTP error body.
export async function readWorkflowLogAcknowledgement(response: Response) {
    if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        const seconds = Number(response.headers.get('retry-after'));
        throw Object.assign(new Error('WORKFLOW_LOG_BATCH_HTTP_ERROR'), {
            status: response.status,
            retryable: response.status === 408 || response.status === 429 || response.status >= 500,
            retryAfterMs: Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0,
        });
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error('WORKFLOW_LOG_BATCH_EMPTY_ACK');
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            bytes += value.byteLength;
            if (bytes > 4096) throw new Error('WORKFLOW_LOG_BATCH_ACK_TOO_LARGE');
            chunks.push(value);
        }
        const body = new Uint8Array(bytes);
        let offset = 0;
        for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
        return JSON.parse(new TextDecoder().decode(body));
    } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
    }
}
