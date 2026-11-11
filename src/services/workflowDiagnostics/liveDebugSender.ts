// Best-effort sender for live debugger updates only (WW-6080).
// It holds only bounded strings, never raw contexts or capture closures, and never rejects.
// Items are { body, bytes, isError, target?, done? }; `done` runs once the item is sent, failed or dropped.

export const LIVE_DEBUG_SENDER_LIMITS = Object.freeze({
    maxInFlight: 1,
    maxPending: 8,
    maxPendingBytes: 256 * 1024,
    timeoutMs: 10_000,
});

type LiveDebugItem = { body: string; bytes: number; isError?: boolean; target?: string; done?: () => void };
type OmissionReport = { dropped: number; droppedErrors: number; failed: number; failedErrors: number };
type Options = {
    transport: (item: LiveDebugItem, options: { signal: AbortSignal }) => unknown;
    annotate?: (body: string, report: OmissionReport) => string;
    maxPending?: number;
    maxPendingBytes?: number;
    timeoutMs?: number;
};

export function createLiveDebugSender({
    transport,
    annotate,
    maxPending = LIVE_DEBUG_SENDER_LIMITS.maxPending,
    maxPendingBytes = LIVE_DEBUG_SENDER_LIMITS.maxPendingBytes,
    timeoutMs = LIVE_DEBUG_SENDER_LIMITS.timeoutMs,
}: Options) {
    const pending: LiveDebugItem[] = [];
    let pendingBytes = 0;
    let inFlight = false;
    let sent = 0;
    const totals: OmissionReport = { dropped: 0, droppedErrors: 0, failed: 0, failedErrors: 0 };
    // Omissions not yet reported inside a successfully sent record.
    const unreported = { ...totals };
    let idleWaiters: (() => void)[] = [];

    function count(kind: 'dropped' | 'failed', item: LiveDebugItem) {
        for (const report of [totals, unreported]) {
            report[kind] += 1;
            if (item.isError) report[kind === 'dropped' ? 'droppedErrors' : 'failedErrors'] += 1;
        }
    }

    function settle(item: LiveDebugItem) {
        try {
            item.done?.();
        } catch {
            // Diagnostics never affect the caller.
        }
    }

    function drop(item: LiveDebugItem) {
        count('dropped', item);
        settle(item);
    }

    // Oldest non-error record first; with only errors pending, the oldest error.
    function evictionIndex() {
        const index = pending.findIndex(item => !item.isError);
        return index === -1 ? 0 : index;
    }

    function enqueue(item: LiveDebugItem) {
        try {
            if (item.bytes > maxPendingBytes) return drop(item);
            const hasRoom = () => pending.length < maxPending && pendingBytes + item.bytes <= maxPendingBytes;
            while (!hasRoom()) {
                const index = evictionIndex();
                // A non-error record never displaces an error.
                if (!item.isError && pending[index].isError) return drop(item);
                const [evicted] = pending.splice(index, 1);
                pendingBytes -= evicted.bytes;
                drop(evicted);
            }

            pending.push(item);
            pendingBytes += item.bytes;
            pump();
        } catch {
            settle(item);
        }
    }

    function hasReport(report: OmissionReport) {
        return report.dropped > 0 || report.failed > 0;
    }

    function pump() {
        if (inFlight) return;
        const item = pending.shift();
        if (!item) {
            const waiters = idleWaiters;
            idleWaiters = [];
            for (const resolve of waiters) resolve();
            return;
        }

        pendingBytes -= item.bytes;
        inFlight = true;
        const report = { ...unreported };
        const body = annotate && hasReport(report) ? annotate(item.body, report) : item.body;
        const controller = new AbortController();
        let settled = false;
        const finish = (succeeded: boolean) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            if (succeeded) {
                sent += 1;
                if (body !== item.body) {
                    for (const key of Object.keys(report) as (keyof OmissionReport)[]) unreported[key] -= report[key];
                }
            } else {
                count('failed', item);
                controller.abort();
            }

            inFlight = false;
            settle(item);
            pump();
        };

        const timer = setTimeout(() => finish(false), timeoutMs);
        try {
            Promise.resolve(transport({ ...item, body }, { signal: controller.signal })).then(
                () => finish(true),
                () => finish(false)
            );
        } catch {
            finish(false);
        }
    }

    return {
        enqueue,
        getStats() {
            return { pending: pending.length, pendingBytes, inFlight, sent, ...totals };
        },
        // Resolves once nothing is pending or in flight.
        idle(): Promise<void> {
            if (!inFlight && !pending.length) return Promise.resolve();
            return new Promise(resolve => idleWaiters.push(resolve));
        },
    };
}
