import { describe, expect, it } from 'vitest';
import {
    createElementClassName,
    createElementDescendantLayoutSelector,
    createElementSelector,
    createSectionClassName,
    createSectionContainerSelector,
    encodeStyleSourceId,
} from './selectors';

describe('compact style source identities', () => {
    it('losslessly encodes UUID bytes without padding', () => {
        expect(encodeStyleSourceId('00000000-0000-0000-0000-000000000000')).toBe('uAAAAAAAAAAAAAAAAAAAAAA');
        expect(encodeStyleSourceId('ffffffff-ffff-ffff-ffff-ffffffffffff')).toBe('u_____________________w');
        expect(encodeStyleSourceId('DC1AA2E0-2204-4F75-A5CD-A926EED7DF42')).toBe('u3Bqi4CIET3Wlzakm7tffQg');
    });

    it('keeps arbitrary and UUID identity domains disjoint', () => {
        expect(encodeStyleSourceId('elementA')).toBe('sZWxlbWVudEE');
        expect(encodeStyleSourceId('élément')).toBe('sw6lsw6ltZW50');
        expect(encodeStyleSourceId('0000000000000000')).not.toBe(
            encodeStyleSourceId('00000000-0000-0000-0000-000000000000')
        );
        expect(encodeStyleSourceId('\ud800')).toBe('w2AA');
        expect(encodeStyleSourceId('\ud800')).not.toBe(encodeStyleSourceId('\ufffd'));
    });

    it('uses compact identities consistently across compiler-owned selectors', () => {
        const uid = 'dc1aa2e0-2204-4f75-a5cd-a926eed7df42';
        const token = 'u3Bqi4CIET3Wlzakm7tffQg';

        expect(createElementClassName(uid)).toBe(`ww-e-${token}`);
        expect(createElementSelector(uid)).toBe(`.ww-e-${token}`);
        expect(createElementDescendantLayoutSelector(uid)).toBe(`.ww-e-${token} [data-ww-ls~="${token}"]`);
        expect(createSectionClassName(uid)).toBe(`ww-s-${token}`);
        expect(createSectionContainerSelector(uid)).toBe(`.ww-s-${token}`);
    });

    it('prefers a persisted dense identity across every compiler-owned selector', () => {
        const uid = 'dc1aa2e0-2204-4f75-a5cd-a926eed7df42';

        expect(encodeStyleSourceId(uid, 3_844)).toBe('d100');
        expect(createElementClassName(uid, 3_844)).toBe('ww-e-d100');
        expect(createElementSelector(uid, 3_844)).toBe('.ww-e-d100');
        expect(createElementDescendantLayoutSelector(uid, undefined, 3_844)).toBe('.ww-e-d100 [data-ww-ls~="d100"]');
        expect(createSectionClassName(uid, 3_844)).toBe('ww-s-d100');
        expect(createSectionContainerSelector(uid, 3_844)).toBe('.ww-s-d100');
    });
});
