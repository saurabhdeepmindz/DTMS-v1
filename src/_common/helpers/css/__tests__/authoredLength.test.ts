import { describe, expect, it } from 'vitest';

import {
    AUTHORED_LENGTH_KEYWORDS,
    authoredLengthToPixels,
    formatAuthoredLength,
    isAuthoredLengthKeyword,
    parseAuthoredLength,
    pixelsToAuthoredLength,
    quantizeAuthoredLength,
    splitAuthoredLength,
    type AuthoredLengthContext,
} from '../authoredLength';

const context: AuthoredLengthContext = {
    percentBase: 400,
    fontSize: 20,
    rootFontSize: 16,
    viewportWidth: 1200,
    viewportHeight: 800,
};

describe('authored length semantics', () => {
    it('classifies fixed, content-driven, dynamic and unset values', () => {
        expect(parseAuthoredLength('25%')).toEqual({ kind: 'fixed', value: 25, unit: '%' });
        expect(parseAuthoredLength('fit-content')).toEqual({ kind: 'content', label: 'Fit' });
        expect(parseAuthoredLength({ __wwtype: 'f', code: 'variables.size' })).toEqual({ kind: 'dynamic' });
        expect(parseAuthoredLength('var(--space)')).toEqual({ kind: 'dynamic' });
        expect(parseAuthoredLength(undefined)).toEqual({ kind: 'unset' });
    });

    it('recognizes every authored keyword from the canonical vocabulary', () => {
        for (const keyword of AUTHORED_LENGTH_KEYWORDS) expect(isAuthoredLengthKeyword(keyword)).toBe(true);
        expect(isAuthoredLengthKeyword('px')).toBe(false);
    });

    it('round-trips all supported fixed units through rendered pixels', () => {
        for (const [value, unit] of [
            [120, 'px'],
            [25, '%'],
            [2, 'em'],
            [2, 'rem'],
            [10, 'vw'],
            [10, 'vh'],
        ] as const) {
            expect(pixelsToAuthoredLength(authoredLengthToPixels(value, unit, context), unit, context)).toBeCloseTo(
                value
            );
        }
    });

    it('formats non-negative values with unit-appropriate precision', () => {
        expect(formatAuthoredLength(12.6, 'px')).toBe('13px');
        expect(formatAuthoredLength(12.3456, '%')).toBe('12.35%');
        expect(formatAuthoredLength(-2, 'rem')).toBe('0rem');
    });

    it('quantizes direct manipulation in semantic unit steps', () => {
        expect(quantizeAuthoredLength(60.17, '%')).toBe(60);
        expect(quantizeAuthoredLength(1.19, 'rem')).toBe(1.25);
        expect(quantizeAuthoredLength(12.6, 'px')).toBe(13);
        expect(quantizeAuthoredLength(8.26, 'vw')).toBe(8.3);
    });

    it('preserves the permissive public length splitter behavior', () => {
        expect(splitAuthoredLength('fit-content')).toEqual([0, 'fit-content']);
        expect(splitAuthoredLength('12.5rem', { round: false })).toEqual(['12.5', 'rem']);
        expect(splitAuthoredLength('12.5rem')).toEqual([13, 'rem']);
        expect(splitAuthoredLength('', { defaultLength: 8, defaultUnit: 'px' })).toEqual([8, 'px']);
        expect(splitAuthoredLength(null, { defaultLength: 8, defaultUnit: 'px' })).toEqual([0, 'auto']);
    });

    it('keeps quantized resize values inside their shared bounds', () => {
        expect(quantizeAuthoredLength(13.4375, 'em', { minimum: 0, maximum: 13.4375 })).toBe(13.375);
        expect(quantizeAuthoredLength(33.1, '%', { minimum: 33.1, maximum: 100 })).toBe(34);
        expect(quantizeAuthoredLength(10.6, 'px', { minimum: 0, maximum: 10.6 })).toBe(10);
        expect(quantizeAuthoredLength(8.3, 'vw', { minimum: 0, maximum: 8.3 })).toBeCloseTo(8.3);
    });

    it('keeps the exact value when a narrow interval contains no unit step', () => {
        expect(quantizeAuthoredLength(10.2, 'px', { minimum: 10.1, maximum: 10.4 })).toBe(10.2);
    });

    it('accounts for browser measurement precision without rounding past meaningful limits', () => {
        expect(quantizeAuthoredLength(299.999994, 'px', { minimum: 0, maximum: 299.999994, tolerance: 0.01 })).toBe(
            300
        );
        expect(quantizeAuthoredLength(13.4375, 'em', { minimum: 0, maximum: 13.4375, tolerance: 1 / 3072 })).toBe(
            13.375
        );
    });
});
