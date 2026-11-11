import { describe, expect, it } from 'vitest';
import { serializeTableViewQueryParameters } from './tableViewQueryParameters';

describe('serializeTableViewQueryParameters', () => {
    it('preserves structured Table View parameter overrides as JSON', () => {
        expect(
            serializeTableViewQueryParameters({
                customer: { name: 'Ada', tags: ['vip'] },
                status: 'active',
                limit: 25,
                archived: false,
            })
        ).toEqual({
            customer: '{"name":"Ada","tags":["vip"]}',
            status: 'active',
            limit: 25,
            archived: false,
        });
    });
});
