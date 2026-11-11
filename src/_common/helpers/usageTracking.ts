import { isEqual } from 'lodash-es';

// Which no-code features of the editor users touch by hand, never the values they set: `trackUsage(id)`
// counts an id (`{ bind: true }`: a field bound to a formula rather than set), and every FLUSH_INTERVAL the counts are
// sent as one batch, then cleared.
// Call it from UI handlers only: helpers and stores are also used by the AI, which must not be counted.
// The canvas iframe is a separate bundle, so the one tracker lives on the editor window.

// Every 10 s on a local editor, to see the logs soon while testing
export const FLUSH_INTERVAL = import.meta.env.VITE_APP_ENV_MODE === 'development' ? 10_000 : 30_000;
// A repeat of the same id within this delay (typing in a field that saves on each key) is not counted
export const COOLDOWN = 2_000;
// The longest event name log-ingest takes, which refuses the whole batch past it. The ids of coded components carry their
// own names (editElementProp:<name>.<key>): a longer one is truncated rather than losing the batch.
export const MAX_ID_LENGTH = 128;

// The user is the one of the session token, and the time the one the batch is received at (services/log-ingest)
export type UsageBatch = {
    workspaceId: string | null;
    projectId: string | null;
    counts: Record<string, number>;
    // The ids tracked as binds, counted apart from the same ids set by hand
    bindCounts: Record<string, number>;
};

export type TrackOptions = { bind?: boolean };

export type UsageTracker = {
    track: (id: string, options?: TrackOptions) => void;
    flush: () => void;
};

type TrackerOptions = {
    getContext: () => Pick<UsageBatch, 'workspaceId' | 'projectId'>;
    send: (batch: UsageBatch) => void;
    now?: () => number;
};

export function createUsageTracker({ getContext, send, now = Date.now }: TrackerOptions): UsageTracker {
    let counts = new Map<string, number>();
    let bindCounts = new Map<string, number>();
    // The cooldown of a bind is apart from the one of a value set by hand
    const lastSeen = { counts: new Map<string, number>(), bindCounts: new Map<string, number>() };

    function track(fullId: string, { bind = false }: TrackOptions = {}) {
        const id = fullId.slice(0, MAX_ID_LENGTH);
        const time = now();
        const seen = bind ? lastSeen.bindCounts : lastSeen.counts;
        const last = seen.get(id);
        seen.set(id, time);
        if (last !== undefined && time - last < COOLDOWN) return;
        const target = bind ? bindCounts : counts;
        target.set(id, (target.get(id) ?? 0) + 1);
    }

    function flush() {
        const time = now();
        for (const seen of Object.values(lastSeen)) {
            for (const [id, last] of seen) {
                if (time - last >= COOLDOWN) seen.delete(id);
            }
        }
        if (!counts.size && !bindCounts.size) return;
        const batch = {
            ...getContext(),
            counts: Object.fromEntries(counts),
            bindCounts: Object.fromEntries(bindCounts),
        };
        counts = new Map();
        bindCounts = new Map();
        send(batch);
    }

    return { track, flush };
}

export function installUsageTracker(send: (batch: UsageBatch) => void) {
    const tracker = createUsageTracker({
        getContext: () => {
            const designInfo = wwLib.store.websiteData.designInfo;
            return {
                workspaceId: (designInfo?.organizationId as string | undefined) ?? null,
                projectId: designInfo?.id ?? null,
            };
        },
        send,
    });
    window.wwUsageTracker = tracker;

    setInterval(tracker.flush, FLUSH_INTERVAL);
    // The last counts would be lost when the tab closes
    window.addEventListener('pagehide', tracker.flush);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') tracker.flush();
    });
}

export function trackUsage(id: string | null, options?: TrackOptions) {
    if (!id) return;
    try {
        wwLib.getEditorWindow().wwUsageTracker?.track(id, options);
    } catch {
        // tracking never breaks an edit
    }
}

const EMPTY_VALUES = [null, undefined, ''];

/**
 * Whether an input sent back the value it holds. wwEditorInput, Monaco and others emit their value when it changes from
 * outside (another item opened, a write of the AI or of a workflow) and when they mount: that is not an edit.
 */
export function isSameUsageValue(next: unknown, current: unknown) {
    if (EMPTY_VALUES.includes(next as null) && EMPTY_VALUES.includes(current as null)) return true;
    return isEqual(next, current);
}

/** trackUsage for a field: counted only when the value it sends differs from the stored one. */
export function trackUsageOnChange(id: string | null, next: unknown, current: unknown, options?: TrackOptions) {
    if (isSameUsageValue(next, current)) return;
    trackUsage(id, options);
}
