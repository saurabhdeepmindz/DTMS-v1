import { workdayFormulaCases } from './dateFormulas.cases';
import { FormulaLimitError } from './dateFormulaCore';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { dateFormulas } from './dateFormulas';

describe('dateFormulas', () => {
    describe('date', () => {
        it('should return current date as ISO string', () => {
            const result = dateFormulas.date();
            expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/);
        });

        it('should create date from string', () => {
            const result = dateFormulas.date('2024-06-15');
            expect(result).toBe('2024-06-15T00:00:00.000Z');
        });

        it('should create date from timestamp', () => {
            const result = dateFormulas.date(0);
            expect(result).toBe('1970-01-01T00:00:00.000Z');
        });
    });

    describe('dateRealtime', () => {
        it('should return current date as ISO string', () => {
            const result = dateFormulas.dateRealtime();
            expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/);
        });
    });

    describe('toDateISO', () => {
        it('should convert date string to ISO format', () => {
            const result = dateFormulas.toDateISO('2024-06-15');
            expect(result).toBe('2024-06-15T00:00:00.000Z');
        });

        it('should throw for invalid date', () => {
            expect(() => dateFormulas.toDateISO('invalid')).toThrow('Invalid date');
        });

        it('should throw for empty date', () => {
            expect(() => dateFormulas.toDateISO('')).toThrow('Date parameter is required');
        });
    });

    describe('formatDate', () => {
        const testDate = '2024-06-15T14:30:45.000Z';

        it('should format with default pattern', () => {
            const result = dateFormulas.formatDate(testDate);
            expect(result).toBe('2024-06-15');
        });

        it('should format year tokens', () => {
            expect(dateFormulas.formatDate(testDate, 'YYYY')).toBe('2024');
            expect(dateFormulas.formatDate(testDate, 'YY')).toBe('24');
        });

        it('should format month tokens', () => {
            expect(dateFormulas.formatDate(testDate, 'MM')).toBe('06');
            expect(dateFormulas.formatDate(testDate, 'M')).toBe('6');
        });

        it('should format day tokens', () => {
            expect(dateFormulas.formatDate(testDate, 'DD')).toBe('15');
            expect(dateFormulas.formatDate(testDate, 'D')).toBe('15');
        });

        it('should format complex patterns', () => {
            const result = dateFormulas.formatDate(testDate, 'YYYY-MM-DD');
            expect(result).toBe('2024-06-15');
        });

        it('should format 12-hour time without duplicating the day period', () => {
            const date = '2026-05-18T17:15:49.383';

            expect(dateFormulas.formatDate(date, 'h:mm A', 'en')).toBe('5:15 PM');
            expect(dateFormulas.formatDate(date, 'hh:mm A', 'en')).toBe('05:15 PM');
            expect(dateFormulas.formatDate(date, 'h:mm a', 'en')).toBe('5:15 pm');
        });

        it('should format with locale', () => {
            const result = dateFormulas.formatDate(testDate, 'MMMM', 'fr');
            expect(result.toLowerCase()).toBe('juin');
        });

        it('should return an empty string for invalid date', () => {
            expect(dateFormulas.formatDate('invalid', 'YYYY')).toBe('');
        });
    });

    describe('fromTime / toTime', () => {
        let now: number;

        beforeEach(() => {
            now = Date.now();
            vi.useFakeTimers();
            vi.setSystemTime(now);
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        it('should return relative time for past date', () => {
            const pastDate = new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString();
            const result = dateFormulas.fromTime(pastDate, false, 'en');
            expect(result).toMatch(/2 days ago/i);
        });

        it('should return relative time for future date', () => {
            const futureDate = new Date(now + 2 * 24 * 60 * 60 * 1000).toISOString();
            const result = dateFormulas.fromTime(futureDate, false, 'en');
            expect(result).toMatch(/in 2 days/i);
        });

        it('should return duration without suffix', () => {
            const pastDate = new Date(now - 5 * 60 * 60 * 1000).toISOString();
            const result = dateFormulas.fromTime(pastDate, true, 'en');
            expect(result).toMatch(/5 hours/i);
        });

        it('toTime should be alias for fromTime', () => {
            const pastDate = new Date(now - 1000).toISOString();
            expect(dateFormulas.toTime(pastDate, false, 'en')).toBe(dateFormulas.fromTime(pastDate, false, 'en'));
        });
    });

    describe('compareDate', () => {
        const date1 = '2024-06-15T10:00:00.000Z';
        const date2 = '2024-06-15T12:30:00.000Z';

        it('should compare dates in milliseconds by default', () => {
            const result = dateFormulas.compareDate(date1, date2);
            expect(result).toBe(9000000);
        });

        it('should compare dates in seconds', () => {
            const result = dateFormulas.compareDate(date1, date2, 'second');
            expect(result).toBe(9000);
        });

        it('should compare dates in minutes', () => {
            const result = dateFormulas.compareDate(date1, date2, 'minute');
            expect(result).toBe(150);
        });

        it('should compare dates in hours', () => {
            const result = dateFormulas.compareDate(date1, date2, 'hour');
            expect(result).toBe(2);
        });

        it('should compare dates in days', () => {
            const d1 = '2024-06-10T00:00:00.000Z';
            const d2 = '2024-06-15T00:00:00.000Z';
            expect(dateFormulas.compareDate(d1, d2, 'day')).toBe(5);
        });

        it('should return float when requested', () => {
            const result = dateFormulas.compareDate(date1, date2, 'hour', true);
            expect(result).toBe(2.5);
        });

        it('should return negative for reversed dates', () => {
            const result = dateFormulas.compareDate(date2, date1, 'hour');
            expect(result).toBe(-3);
        });
    });

    describe('getSecond', () => {
        it('should get seconds from date', () => {
            expect(dateFormulas.getSecond('2024-06-15T14:30:45.000Z')).toBe(45);
        });

        it('should get seconds from current date when no param', () => {
            const result = dateFormulas.getSecond();
            expect(result).toBeGreaterThanOrEqual(0);
            expect(result).toBeLessThan(60);
        });
    });

    describe('getMinute', () => {
        it('should get minutes from date', () => {
            expect(dateFormulas.getMinute('2024-06-15T14:30:45.000Z')).toBe(30);
        });
    });

    describe('getHour', () => {
        it('should get hours from date', () => {
            const date = new Date(2024, 5, 15, 14, 30, 45);
            expect(dateFormulas.getHour(date.toISOString())).toBe(14);
        });
    });

    describe('getDay', () => {
        it('should get day of month from date', () => {
            expect(dateFormulas.getDay('2024-06-15T14:30:45.000Z')).toBe(15);
        });
    });

    describe('getDayOfWeek', () => {
        it('should get day of week (0=Sunday)', () => {
            expect(dateFormulas.getDayOfWeek('2024-06-15T00:00:00.000Z')).toBe(6);
            expect(dateFormulas.getDayOfWeek('2024-06-16T00:00:00.000Z')).toBe(0);
        });
    });

    describe('getMonth', () => {
        it('should get month (1-indexed)', () => {
            expect(dateFormulas.getMonth('2024-06-15T14:30:45.000Z')).toBe(6);
            expect(dateFormulas.getMonth('2024-01-01T00:00:00.000Z')).toBe(1);
            expect(dateFormulas.getMonth('2024-12-31T00:00:00.000Z')).toBe(12);
        });
    });

    describe('getYear', () => {
        it('should get year from date', () => {
            expect(dateFormulas.getYear('2024-06-15T14:30:45.000Z')).toBe(2024);
        });
    });

    describe('getDayOfYear', () => {
        it('should get day of year', () => {
            expect(dateFormulas.getDayOfYear('2024-01-01T00:00:00.000Z')).toBe(1);
            expect(dateFormulas.getDayOfYear('2024-12-31T00:00:00.000Z')).toBe(366);
        });
    });

    describe('getWeekOfYear', () => {
        it('should get week of year', () => {
            const result = dateFormulas.getWeekOfYear('2024-01-15T00:00:00.000Z');
            expect(result).toBeGreaterThan(0);
            expect(result).toBeLessThanOrEqual(53);
        });
    });

    describe('addSeconds', () => {
        it('should add seconds to date', () => {
            const result = dateFormulas.addSeconds('2024-06-15T14:30:00.000Z', 30);
            expect(result).toBe('2024-06-15T14:30:30.000Z');
        });

        it('should subtract seconds with negative value', () => {
            const result = dateFormulas.addSeconds('2024-06-15T14:30:30.000Z', -30);
            expect(result).toBe('2024-06-15T14:30:00.000Z');
        });

        it('should throw for non-number amount', () => {
            expect(() => dateFormulas.addSeconds('2024-06-15', '30' as any)).toThrow();
        });
    });

    describe('addMinutes', () => {
        it('should add minutes to date', () => {
            const result = dateFormulas.addMinutes('2024-06-15T14:30:00.000Z', 15);
            expect(result).toBe('2024-06-15T14:45:00.000Z');
        });
    });

    describe('addHours', () => {
        it('should add hours to date', () => {
            const result = dateFormulas.addHours('2024-06-15T14:00:00.000Z', 3);
            expect(result).toBe('2024-06-15T17:00:00.000Z');
        });
    });

    describe('addDays', () => {
        it('should add days to date', () => {
            const result = dateFormulas.addDays('2024-06-15T14:00:00.000Z', 5);
            expect(result).toBe('2024-06-20T14:00:00.000Z');
        });

        it('should handle month overflow', () => {
            const result = dateFormulas.addDays('2024-06-28T00:00:00.000Z', 5);
            expect(result).toBe('2024-07-03T00:00:00.000Z');
        });
    });

    describe('addMonths', () => {
        it('should add months to date', () => {
            const result = dateFormulas.addMonths('2024-06-15T14:00:00.000Z', 2);
            expect(result).toBe('2024-08-15T14:00:00.000Z');
        });

        it('should handle year overflow', () => {
            const result = dateFormulas.addMonths('2024-11-15T00:00:00.000Z', 3);
            expect(result).toBe('2025-02-15T00:00:00.000Z');
        });
    });

    describe('addYears', () => {
        it('should add years to date', () => {
            const result = dateFormulas.addYears('2024-06-15T14:00:00.000Z', 2);
            expect(result).toBe('2026-06-15T14:00:00.000Z');
        });
    });

    describe('setSecond', () => {
        it('should set seconds on date', () => {
            const result = dateFormulas.setSecond('2024-06-15T14:30:00.000Z', 45);
            expect(result).toContain(':45.');
        });
    });

    describe('setMinute', () => {
        it('should set minutes on date', () => {
            const result = dateFormulas.setMinute('2024-06-15T14:30:00.000Z', 15);
            expect(result).toContain(':15:');
        });
    });

    describe('setHour', () => {
        it('should set hours on date', () => {
            const date = new Date(2024, 5, 15, 14, 30, 0);
            const result = dateFormulas.setHour(date.toISOString(), 8);
            expect(dateFormulas.getHour(result)).toBe(8);
        });
    });

    describe('setDay', () => {
        it('should set day of month', () => {
            const result = dateFormulas.setDay('2024-06-15T14:30:00.000Z', 20);
            expect(result).toContain('-20T');
        });
    });

    describe('setDayOfWeek', () => {
        it('should set day of week', () => {
            const result = dateFormulas.setDayOfWeek('2024-06-15T00:00:00.000Z', 1);
            expect(dateFormulas.getDayOfWeek(result)).toBe(1);
        });
    });

    describe('setMonth', () => {
        it('should set month (1-indexed)', () => {
            const result = dateFormulas.setMonth('2024-06-15T14:30:00.000Z', 3);
            expect(result).toContain('-03-');
        });
    });

    describe('setYear', () => {
        it('should set year', () => {
            const result = dateFormulas.setYear('2024-06-15T14:30:00.000Z', 2030);
            expect(result).toContain('2030-');
        });
    });

    describe('toTimestamp', () => {
        it('should convert date to Unix timestamp', () => {
            const result = dateFormulas.toTimestamp('1970-01-01T00:00:00.000Z');
            expect(result).toBe(0);
        });

        it('should return milliseconds', () => {
            const result = dateFormulas.toTimestamp('1970-01-01T00:00:01.000Z');
            expect(result).toBe(1000);
        });
    });

    describe('getBrowserTimezone', () => {
        it('should return a timezone string', () => {
            const result = dateFormulas.getBrowserTimezone();
            expect(typeof result).toBe('string');
            expect(result.length).toBeGreaterThan(0);
        });
    });

    describe('convertDateTimezone', () => {
        it('should convert date to different timezone', () => {
            const result = dateFormulas.convertDateTimezone('2024-06-15T12:00:00.000Z', 'America/New_York');
            expect(result).toContain('T08:00:00');
        });

        it('should preserve local time when preserve=true', () => {
            const result = dateFormulas.convertDateTimezone('2024-06-15T12:00:00.000Z', 'America/New_York', true);
            expect(result).toContain('T08:00:00');
        });

        it('should throw for invalid timezone type', () => {
            expect(() => dateFormulas.convertDateTimezone('2024-06-15', 123 as any)).toThrow();
        });
    });

    describe('formatDateTimezone', () => {
        it('should format date with timezone', () => {
            const result = dateFormulas.formatDateTimezone(
                '2024-06-15T12:00:00.000Z',
                'YYYY-MM-DD HH:mm',
                'America/New_York'
            );
            expect(result).toContain('2024-06-15');
            expect(result).toContain('08:');
        });

        it('should use default timezone if not specified', () => {
            const result = dateFormulas.formatDateTimezone('2024-06-15T12:00:00.000Z', 'YYYY-MM-DD');
            expect(result).toBe('2024-06-15');
        });

        it('should format 12-hour time without duplicating the day period', () => {
            const result = dateFormulas.formatDateTimezone('2026-05-18T15:15:49.383Z', 'h:mm A', 'Europe/Paris', 'en');

            expect(result).toBe('5:15 PM');
        });
    });
});

describe('workday date helpers', () => {
    const evaluate = (code: string) => new Function('wwFormulas', 'return ' + code)(dateFormulas);
    it.each(workdayFormulaCases)('$name', ({ code, expected }) => {
        expect(evaluate(code)).toEqual(expected);
    });
    it('validates workday inputs', () => {
        expect(() => dateFormulas.addWorkdays('2024-02-31', 1)).toThrow('Invalid date');
        expect(() => dateFormulas.addWorkdays('2024-01-01', 1.5)).toThrow('Expected integer workdays');
        expect(() => dateFormulas.addWorkdays('2024-01-01', 1, ['invalid'])).toThrow('Expected ISO holiday date');
        expect(dateFormulas.addWorkdays(null, 1)).toBeNull();
        expect(dateFormulas.workdayDiff('2024-01-01', null)).toBeNull();
    });
    it('does not hide resource limits', () => {
        expect(() => dateFormulas.addWorkdays('2024-01-01', 10001)).toThrow(FormulaLimitError);
    });
});
