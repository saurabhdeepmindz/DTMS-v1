import { afterEach, describe, it, expect, vi } from 'vitest';
import {
    createUsageTracker,
    isSameUsageValue,
    trackUsageOnChange,
    COOLDOWN,
    MAX_ID_LENGTH,
    type UsageBatch,
} from './usageTracking';

function setup() {
    let time = Date.UTC(2026, 9, 27, 10, 0, 0);
    const batches: UsageBatch[] = [];
    const tracker = createUsageTracker({
        getContext: () => ({ workspaceId: 'workspace-1', projectId: 'project-1' }),
        send: batch => batches.push(batch),
        now: () => time,
    });
    return {
        tracker,
        batches,
        advance: (ms: number) => {
            time += ms;
        },
    };
}

describe('createUsageTracker', () => {
    it('counts each id and sends them in one batch', () => {
        const { tracker, batches, advance } = setup();
        tracker.track('openPanel:pages');
        advance(COOLDOWN);
        tracker.track('openPanel:pages');
        tracker.track('editStyle:margin');
        advance(1000);
        tracker.flush();

        expect(batches).toEqual([
            {
                workspaceId: 'workspace-1',
                projectId: 'project-1',
                counts: { 'openPanel:pages': 2, 'editStyle:margin': 1 },
                bindCounts: {},
            },
        ]);
    });

    it('counts a burst of the same id once', () => {
        const { tracker, batches, advance } = setup();
        for (let i = 0; i < 5; i++) {
            tracker.track('editStyle:margin');
            advance(300);
        }
        tracker.flush();

        expect(batches[0].counts).toEqual({ 'editStyle:margin': 1 });
    });

    it('keeps the cooldown sliding while the id repeats', () => {
        const { tracker, batches, advance } = setup();
        tracker.track('editStyle:margin');
        advance(COOLDOWN - 1);
        tracker.track('editStyle:margin');
        advance(COOLDOWN - 1);
        tracker.track('editStyle:margin');
        tracker.flush();

        expect(batches[0].counts).toEqual({ 'editStyle:margin': 1 });
    });

    it('applies the cooldown per id', () => {
        const { tracker, batches } = setup();
        tracker.track('editStyle:margin');
        tracker.track('editStyle:padding');
        tracker.flush();

        expect(batches[0].counts).toEqual({ 'editStyle:margin': 1, 'editStyle:padding': 1 });
    });

    it('counts a bind apart from the same id set by hand', () => {
        const { tracker, batches } = setup();
        tracker.track('editStyle:margin');
        tracker.track('editStyle:margin', { bind: true });
        tracker.track('editStyle:margin', { bind: true });
        tracker.flush();

        expect(batches[0].counts).toEqual({ 'editStyle:margin': 1 });
        expect(batches[0].bindCounts).toEqual({ 'editStyle:margin': 1 });
    });

    it('sends a batch of binds only', () => {
        const { tracker, batches } = setup();
        tracker.track('editElementProp:ww-text.text', { bind: true });
        tracker.flush();

        expect(batches[0]).toMatchObject({ counts: {}, bindCounts: { 'editElementProp:ww-text.text': 1 } });
    });

    it('truncates an id past the length log-ingest takes', () => {
        const { tracker, batches } = setup();
        const id = `editElementProp:${'a'.repeat(200)}.text`;
        tracker.track(id);
        tracker.flush();

        expect(Object.keys(batches[0].counts)).toEqual([id.slice(0, MAX_ID_LENGTH)]);
    });

    it('clears the counts after a flush', () => {
        const { tracker, batches, advance } = setup();
        tracker.track('createPage');
        tracker.flush();
        advance(COOLDOWN);
        tracker.track('deletePage');
        tracker.flush();

        expect(batches.map(batch => batch.counts)).toEqual([{ createPage: 1 }, { deletePage: 1 }]);
    });

    it('keeps the cooldown across a flush', () => {
        const { tracker, batches, advance } = setup();
        tracker.track('editStyle:margin');
        tracker.flush();
        advance(500);
        tracker.track('editStyle:margin');
        tracker.flush();

        expect(batches).toHaveLength(1);
    });

    it('sends nothing when nothing was tracked', () => {
        const send = vi.fn();
        const tracker = createUsageTracker({ getContext: () => ({ workspaceId: null, projectId: null }), send });
        tracker.flush();

        expect(send).not.toHaveBeenCalled();
    });
});

describe('isSameUsageValue', () => {
    it('compares values deeply', () => {
        expect(isSameUsageValue({ link: '$and', conditions: [1] }, { link: '$and', conditions: [1] })).toBe(true);
        expect(isSameUsageValue({ a: 1 }, { a: 2 })).toBe(false);
        expect(isSameUsageValue(5, '5')).toBe(false);
    });

    it('reads every empty value as the same', () => {
        expect(isSameUsageValue('', undefined)).toBe(true);
        expect(isSameUsageValue(null, '')).toBe(true);
        expect(isSameUsageValue('', 'a')).toBe(false);
    });
});

describe('trackUsageOnChange', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('counts a field only when the value it sends differs from the stored one', () => {
        const track = vi.fn();
        vi.stubGlobal('wwLib', { getEditorWindow: () => ({ wwUsageTracker: { track } }) });

        trackUsageOnChange('editVariable:defaultValue', 'stored', 'stored');
        trackUsageOnChange('editVariable:defaultValue', 'typed', 'stored', { bind: false });

        expect(track.mock.calls).toEqual([['editVariable:defaultValue', { bind: false }]]);
    });
});
