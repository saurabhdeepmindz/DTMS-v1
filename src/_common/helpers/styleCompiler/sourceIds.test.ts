import { describe, expect, it } from 'vitest';
import { assignDenseStyleSourceIds, createStyleSourceIdRegistry, encodeDenseStyleSourceId } from './sourceIds';

describe('dense persisted style source ids', () => {
    it('encodes non-negative integers as prefixed base62 CSS identifiers', () => {
        expect(encodeDenseStyleSourceId(0)).toBe('d0');
        expect(encodeDenseStyleSourceId(61)).toBe('dz');
        expect(encodeDenseStyleSourceId(62)).toBe('d10');
        expect(encodeDenseStyleSourceId(3_844)).toBe('d100');
        expect(encodeDenseStyleSourceId(-1)).toBeUndefined();
    });

    it('reserves persisted ids before allocating missing sources', () => {
        const sources = [{ uid: 'missing' }, { uid: 'persisted', _si: 0 }];

        const registry = assignDenseStyleSourceIds(sources);

        expect(sources).toEqual([
            { uid: 'missing', _si: 1 },
            { uid: 'persisted', _si: 0 },
        ]);
        expect(registry.nextId).toBe(2);
    });

    it('repairs copied ids and reuses one id for repeated source records', () => {
        const registry = createStyleSourceIdRegistry();
        const first = { uid: 'first', _si: 7 };
        const copied = { uid: 'copied', _si: 7 };
        const repeated = { uid: 'first', _si: undefined as number | undefined };

        assignDenseStyleSourceIds([first, copied, repeated], registry);

        expect(first._si).toBe(7);
        expect(copied._si).toBe(8);
        expect(repeated._si).toBe(7);
    });

    it('keeps the session identity when stale data for a known uid is loaded', () => {
        const registry = assignDenseStyleSourceIds([{ uid: 'source', _si: 4 }]);
        const reloaded = { uid: 'source', _si: 12 };

        assignDenseStyleSourceIds([reloaded], registry);

        expect(reloaded._si).toBe(4);
    });
});
