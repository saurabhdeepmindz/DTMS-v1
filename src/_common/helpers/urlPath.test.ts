import { describe, it, expect } from 'vitest';
import { joinUrlPath } from './urlPath';

describe('joinUrlPath', () => {
    it('joins simple segments with single slashes', () => {
        expect(joinUrlPath('api', 'users', '123')).toBe('api/users/123');
    });

    it('preserves leading slash from the first segment', () => {
        expect(joinUrlPath('/api', 'users', '123')).toBe('/api/users/123');
    });

    it('strips duplicate slashes between segments', () => {
        expect(joinUrlPath('/api/', '/users/', '/123/')).toBe('/api/users/123');
    });

    it('strips multiple consecutive slashes', () => {
        expect(joinUrlPath('//api//', '//users//')).toBe('/api/users');
    });

    it('returns empty string when no valid segments are provided', () => {
        expect(joinUrlPath()).toBe('');
        expect(joinUrlPath('')).toBe('');
    });

    it('handles a single segment', () => {
        expect(joinUrlPath('/api')).toBe('/api');
        expect(joinUrlPath('api')).toBe('api');
    });

    it('preserves the protocol when first segment is a full URL', () => {
        expect(joinUrlPath('https://example.com', 'api', 'users')).toBe('https://example.com/api/users');
    });

    it('handles trailing slash on full URL base', () => {
        expect(joinUrlPath('https://example.com/', '/api/', '/users')).toBe('https://example.com/api/users');
    });

    it('coerces numeric segments to strings', () => {
        expect(joinUrlPath('/api', 'users', 42)).toBe('/api/users/42');
    });

    it('does not add a leading slash when first segment lacks one', () => {
        expect(joinUrlPath('api', '/users')).toBe('api/users');
    });

    it('treats segments containing only slashes as empty', () => {
        expect(joinUrlPath('/api', '///', 'users')).toBe('/api/users');
    });

    it('handles the workflow webhook use case', () => {
        const path = '/ww/workflows/abc-123';
        expect(joinUrlPath('/api', path)).toBe('/api/ww/workflows/abc-123');
    });

    it('handles a path that does not start with a slash', () => {
        expect(joinUrlPath('/api', 'ww/workflows/abc-123')).toBe('/api/ww/workflows/abc-123');
    });
});
