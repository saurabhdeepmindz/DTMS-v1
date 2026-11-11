export type DateFormulaAdapters = {
    getLanguage: () => string;
    getRealtimeDate: () => string;
};

const RELATIVE_TIME_UNITS: { unit: Intl.RelativeTimeFormatUnit; ms: number }[] = [
    { unit: 'year', ms: 31536000000 },
    { unit: 'month', ms: 2628000000 },
    { unit: 'week', ms: 604800000 },
    { unit: 'day', ms: 86400000 },
    { unit: 'hour', ms: 3600000 },
    { unit: 'minute', ms: 60000 },
    { unit: 'second', ms: 1000 },
];

type NumberFormatUnit = 'year' | 'month' | 'week' | 'day' | 'hour' | 'minute' | 'second';

function getRelativeTime(date: string | Date, locale = 'en'): string {
    const diff = new Date(date).getTime() - Date.now();
    const absDiff = Math.abs(diff);

    for (const { unit, ms } of RELATIVE_TIME_UNITS) {
        if (absDiff >= ms || unit === 'second') {
            const value = Math.round(diff / ms);
            const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
            return rtf.format(value, unit);
        }
    }
    return '';
}

function getRelativeTimeDuration(date: string | Date, locale = 'en'): string {
    const diff = new Date(date).getTime() - Date.now();
    const absDiff = Math.abs(diff);

    for (const { unit, ms } of RELATIVE_TIME_UNITS) {
        if (absDiff >= ms || unit === 'second') {
            const value = Math.round(absDiff / ms);
            const formatter = new Intl.NumberFormat(locale, {
                style: 'unit',
                unit: unit as NumberFormatUnit,
                unitDisplay: 'long',
            });
            return formatter.format(value);
        }
    }
    return '';
}

const DATE_TOKEN_MAP: Record<string, Intl.DateTimeFormatOptions> = {
    YYYY: { year: 'numeric' },
    YY: { year: '2-digit' },
    MMMM: { month: 'long' },
    MMM: { month: 'short' },
    MM: { month: '2-digit' },
    M: { month: 'numeric' },
    DD: { day: '2-digit' },
    D: { day: 'numeric' },
    dddd: { weekday: 'long' },
    ddd: { weekday: 'short' },
    dd: { weekday: 'narrow' },
    HH: { hour: '2-digit', hour12: false },
    H: { hour: 'numeric', hour12: false },
    hh: { hour: '2-digit', hour12: true },
    h: { hour: 'numeric', hour12: true },
    mm: { minute: '2-digit' },
    m: { minute: 'numeric' },
    ss: { second: '2-digit' },
    s: { second: 'numeric' },
    SSS: { fractionalSecondDigits: 3 },
    A: { hour12: true },
    a: { hour12: true },
};

type DateTokenPartType =
    | 'year'
    | 'month'
    | 'day'
    | 'weekday'
    | 'hour'
    | 'minute'
    | 'second'
    | 'fractionalSecond'
    | 'dayPeriod';

const DATE_TOKEN_PART_MAP: Record<string, DateTokenPartType> = {
    YYYY: 'year',
    YY: 'year',
    MMMM: 'month',
    MMM: 'month',
    MM: 'month',
    M: 'month',
    DD: 'day',
    D: 'day',
    dddd: 'weekday',
    ddd: 'weekday',
    dd: 'weekday',
    HH: 'hour',
    H: 'hour',
    hh: 'hour',
    h: 'hour',
    mm: 'minute',
    m: 'minute',
    ss: 'second',
    s: 'second',
    SSS: 'fractionalSecond',
};

function getDatePartValue(
    date: Date,
    locale: string,
    options: Intl.DateTimeFormatOptions,
    partType: DateTokenPartType
): string | undefined {
    const formatter = new Intl.DateTimeFormat(locale, options);
    return formatter.formatToParts(date).find(part => part.type === partType)?.value;
}

function formatDateToken(
    date: Date,
    locale: string,
    options: Intl.DateTimeFormatOptions,
    partType?: DateTokenPartType
): string {
    const formatter = new Intl.DateTimeFormat(locale, options);
    if (!partType) return formatter.format(date);

    return formatter.formatToParts(date).find(part => part.type === partType)?.value || formatter.format(date);
}

function getDayPeriod(date: Date, locale: string, options: Intl.DateTimeFormatOptions): string {
    const dayPeriod = getDatePartValue(date, locale, { ...options, hour: 'numeric', hour12: true }, 'dayPeriod');
    if (dayPeriod) return dayPeriod;

    const hour = Number(getDatePartValue(date, 'en-US', { ...options, hour: 'numeric', hour12: false }, 'hour'));
    return hour >= 12 && hour < 24 ? 'PM' : 'AM';
}

function formatDateWithPattern(date: string | Date, pattern: string, locale = 'en', timeZone?: string): string {
    try {
        const d = new Date(date);
        if (isNaN(d.getTime())) throw 'Invalid date';

        const options: Intl.DateTimeFormatOptions = timeZone ? { timeZone } : {};

        const sortedTokens = Object.keys(DATE_TOKEN_MAP).sort((a, b) => b.length - a.length);
        const tokenRegex = new RegExp(`(${sortedTokens.join('|')}|\\[[^\\]]*\\])`, 'g');

        return pattern.replace(tokenRegex, match => {
            if (match.startsWith('[') && match.endsWith(']')) {
                return match.slice(1, -1);
            }

            if (match === 'A' || match === 'a') {
                const dayPeriod = getDayPeriod(d, locale, options);
                return match === 'a' ? dayPeriod.toLowerCase() : dayPeriod.toUpperCase();
            }

            const tokenOptions = DATE_TOKEN_MAP[match];
            if (!tokenOptions) return match;

            return formatDateToken(d, locale, { ...options, ...tokenOptions }, DATE_TOKEN_PART_MAP[match]);
        });
    } catch (e) {
        return ``;
    }
}

function parseDate(date: unknown): Date {
    if (!date) throw 'Date parameter is required';
    const d = new Date(date as string | number | Date);
    if (isNaN(d.getTime())) throw 'Invalid date';
    return d;
}

type DatePrecision = 'millisecond' | 'second' | 'minute' | 'hour' | 'day' | 'week' | 'month' | 'year';

/** Shared workday helpers mirrored in the Editor and Back Publisher. */
export class FormulaLimitError extends Error {}
const WORKDAY_MS = 86400000;
function requireWorkdayNumber(value: unknown): number {
    if (typeof value !== 'number') throw new Error('Expected a number');
    return value;
}
function requireWorkdayText(value: unknown): string {
    if (typeof value !== 'string') throw new Error('Expected text');
    return value;
}
function utcWorkdayDate(year: number, month: number, day: number): Date {
    const date = new Date(0);
    date.setUTCFullYear(year, month - 1, day);
    date.setUTCHours(0, 0, 0, 0);
    return date;
}
function parseWorkdayDate(value: unknown): Date {
    if (value instanceof Date) {
        if (!Number.isFinite(value.getTime())) throw new Error('Invalid date');
        return new Date(value);
    }
    const source = requireWorkdayText(value);
    const parts = /^(\d{4})-(\d{2})-(\d{2})(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2}))?$/.exec(
        source
    );
    if (!parts) throw new Error('Expected an ISO date');
    const calendar = utcWorkdayDate(+parts[1], +parts[2], +parts[3]);
    if (calendar.getUTCMonth() !== +parts[2] - 1 || calendar.getUTCDate() !== +parts[3])
        throw new Error('Invalid date');
    const result = new Date(source);
    if (!Number.isFinite(result.getTime())) throw new Error('Invalid date');
    return result;
}
function parseWorkdayHolidays(value: unknown): Set<string> {
    if (value == null) return new Set();
    const items = typeof value === 'string' ? (value === '' ? [] : value.split(',')) : value;
    if (!Array.isArray(items)) throw new Error('Expected holiday dates');
    if (items.length > 10000) throw new FormulaLimitError('Holiday collection limit exceeded');
    return new Set(
        items.map(item => {
            const source = requireWorkdayText(item).trim();
            if (!/^\d{4}-\d{2}-\d{2}$/.test(source)) throw new Error('Expected ISO holiday date');
            return parseWorkdayDate(source).toISOString().slice(0, 10);
        })
    );
}
function isWorkday(day: Date, excluded: Set<string>): boolean {
    return day.getUTCDay() !== 0 && day.getUTCDay() !== 6 && !excluded.has(day.toISOString().slice(0, 10));
}

export function createDateFormulas(adapters: DateFormulaAdapters) {
    return {
        addWorkdays(value: unknown, days: unknown, excluded?: unknown) {
            if (value == null) return null;
            const result = parseWorkdayDate(value),
                count = requireWorkdayNumber(days),
                closed = parseWorkdayHolidays(excluded);
            if (!Number.isInteger(count)) throw new Error('Expected integer workdays');
            if (Math.abs(count) > 10000) throw new FormulaLimitError('Iteration limit exceeded');
            let remaining = Math.abs(count),
                visited = 0;
            while (remaining) {
                if (++visited > 30000) throw new FormulaLimitError('Iteration limit exceeded');
                result.setUTCDate(result.getUTCDate() + Math.sign(count));
                if (isWorkday(result, closed)) remaining--;
            }
            return result.toISOString();
        },
        workdayDiff(a: unknown, b: unknown, excluded?: unknown) {
            if (a == null || b == null) return null;
            const first = parseWorkdayDate(a).getTime(),
                last = parseWorkdayDate(b).getTime(),
                closed = parseWorkdayHolidays(excluded);
            const start = Math.floor(Math.min(first, last) / WORKDAY_MS),
                end = Math.floor(Math.max(first, last) / WORKDAY_MS),
                span = end - start + 1;
            let count = Math.floor(span / 7) * 5;
            for (let i = 0; i < span % 7; i++) if (isWorkday(new Date((start + i) * WORKDAY_MS), new Set())) count++;
            for (const holiday of closed) {
                const day = parseWorkdayDate(holiday);
                if (
                    day.getTime() / WORKDAY_MS >= start &&
                    day.getTime() / WORKDAY_MS <= end &&
                    isWorkday(day, new Set())
                )
                    count--;
            }
            return count * (first > last ? -1 : 1);
        },

        date(...args: (string | number | Date)[]): string {
            return new Date(...(args as [string | number | Date])).toISOString();
        },

        dateRealtime(): string {
            return adapters.getRealtimeDate();
        },

        toDateISO(date: string | Date): string {
            return parseDate(date).toISOString();
        },

        formatDate(date: string | Date, format = 'YYYY-MM-DD', locale?: string): string {
            const lang = locale || adapters.getLanguage();
            return formatDateWithPattern(date, format, lang);
        },

        fromTime(date: string | Date, withoutSuffix = false, locale?: string): string {
            const lang = locale || adapters.getLanguage();
            if (withoutSuffix) {
                return getRelativeTimeDuration(date, lang);
            }
            return getRelativeTime(date, lang);
        },

        toTime(date: string | Date, withoutSuffix = false, locale?: string): string {
            return this.fromTime(date, withoutSuffix, locale);
        },

        compareDate(
            date1: string | Date,
            date2: string | Date,
            precision: DatePrecision = 'millisecond',
            float = false
        ): number {
            const d1 = parseDate(date1);
            const d2 = parseDate(date2);
            const diffMs = d2.getTime() - d1.getTime();

            const divisors: Record<DatePrecision, number> = {
                millisecond: 1,
                second: 1000,
                minute: 60000,
                hour: 3600000,
                day: 86400000,
                week: 604800000,
                month: 2628000000,
                year: 31536000000,
            };

            const divisor = divisors[precision] || 1;
            const result = diffMs / divisor;
            return float ? result : Math.floor(result);
        },

        getSecond(date?: string | Date): number {
            const d = date ? parseDate(date) : new Date();
            return d.getSeconds();
        },

        getMinute(date?: string | Date): number {
            const d = date ? parseDate(date) : new Date();
            return d.getMinutes();
        },

        getHour(date?: string | Date): number {
            const d = date ? parseDate(date) : new Date();
            return d.getHours();
        },

        getDay(date?: string | Date): number {
            const d = date ? parseDate(date) : new Date();
            return d.getDate();
        },

        getDayOfWeek(date?: string | Date): number {
            const d = date ? parseDate(date) : new Date();
            return d.getDay();
        },

        getMonth(date?: string | Date): number {
            const d = date ? parseDate(date) : new Date();
            return d.getMonth() + 1;
        },

        getYear(date?: string | Date): number {
            const d = date ? parseDate(date) : new Date();
            return d.getFullYear();
        },

        getDayOfYear(date?: string | Date): number {
            const d = date ? parseDate(date) : new Date();
            const start = new Date(d.getFullYear(), 0, 0);
            const diff = d.getTime() - start.getTime();
            return Math.floor(diff / 86400000);
        },

        getWeekOfYear(date?: string | Date): number {
            const d = date ? parseDate(date) : new Date();
            const startOfYear = new Date(d.getFullYear(), 0, 1);
            const dayOfYear = Math.floor((d.getTime() - startOfYear.getTime()) / 86400000);
            return Math.ceil((dayOfYear + startOfYear.getDay() + 1) / 7);
        },

        addSeconds(date: string | Date, amount: number): string {
            const d = parseDate(date);
            if (typeof amount !== 'number') throw 'Second parameter must be a number';
            return new Date(d.getTime() + amount * 1000).toISOString();
        },

        addMinutes(date: string | Date, amount: number): string {
            const d = parseDate(date);
            if (typeof amount !== 'number') throw 'Second parameter must be a number';
            return new Date(d.getTime() + amount * 60000).toISOString();
        },

        addHours(date: string | Date, amount: number): string {
            const d = parseDate(date);
            if (typeof amount !== 'number') throw 'Second parameter must be a number';
            return new Date(d.getTime() + amount * 3600000).toISOString();
        },

        addDays(date: string | Date, amount: number): string {
            const d = parseDate(date);
            if (typeof amount !== 'number') throw 'Second parameter must be a number';
            return new Date(d.getTime() + amount * 86400000).toISOString();
        },

        addMonths(date: string | Date, amount: number): string {
            const d = parseDate(date);
            if (typeof amount !== 'number') throw 'Second parameter must be a number';
            const result = new Date(d);
            result.setMonth(result.getMonth() + amount);
            return result.toISOString();
        },

        addYears(date: string | Date, amount: number): string {
            const d = parseDate(date);
            if (typeof amount !== 'number') throw 'Second parameter must be a number';
            const result = new Date(d);
            result.setFullYear(result.getFullYear() + amount);
            return result.toISOString();
        },

        setSecond(date: string | Date, value: number): string {
            const d = parseDate(date);
            if (typeof value !== 'number') throw 'Second parameter must be a number';
            const result = new Date(d);
            result.setSeconds(value);
            return result.toISOString();
        },

        setMinute(date: string | Date, value: number): string {
            const d = parseDate(date);
            if (typeof value !== 'number') throw 'Second parameter must be a number';
            const result = new Date(d);
            result.setMinutes(value);
            return result.toISOString();
        },

        setHour(date: string | Date, value: number): string {
            const d = parseDate(date);
            if (typeof value !== 'number') throw 'Second parameter must be a number';
            const result = new Date(d);
            result.setHours(value);
            return result.toISOString();
        },

        setDay(date: string | Date, value: number): string {
            const d = parseDate(date);
            if (typeof value !== 'number') throw 'Second parameter must be a number';
            const result = new Date(d);
            result.setDate(value);
            return result.toISOString();
        },

        setDayOfWeek(date: string | Date, value: number): string {
            const d = parseDate(date);
            if (typeof value !== 'number') throw 'Second parameter must be a number';
            const currentDay = d.getDay();
            const diff = value - currentDay;
            return new Date(d.getTime() + diff * 86400000).toISOString();
        },

        setMonth(date: string | Date, value: number): string {
            const d = parseDate(date);
            if (typeof value !== 'number') throw 'Second parameter must be a number';
            const result = new Date(d);
            result.setMonth(value - 1);
            return result.toISOString();
        },

        setYear(date: string | Date, value: number): string {
            const d = parseDate(date);
            if (typeof value !== 'number') throw 'Second parameter must be a number';
            const result = new Date(d);
            result.setFullYear(value);
            return result.toISOString();
        },

        toTimestamp(date: string | Date): number {
            return parseDate(date).getTime();
        },

        getBrowserTimezone(): string {
            return Intl.DateTimeFormat().resolvedOptions().timeZone;
        },

        convertDateTimezone(date: string | Date, timezone: string, preserve = false): string {
            const d = parseDate(date);
            if (typeof timezone !== 'string') throw 'Second parameter must be a string';

            if (preserve) {
                const formatter = new Intl.DateTimeFormat('en-US', {
                    timeZone: timezone,
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    hour12: false,
                });
                const parts = formatter.formatToParts(d);
                const get = (type: string) => parts.find(p => p.type === type)?.value || '00';
                return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}`;
            }

            const formatter = new Intl.DateTimeFormat('sv-SE', {
                timeZone: timezone,
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: false,
            });
            return formatter.format(d).replace(' ', 'T');
        },

        formatDateTimezone(date: string | Date, format = 'YYYY-MM-DD', timezone?: string, locale?: string): string {
            const tz = timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
            const lang = locale || adapters.getLanguage();
            return formatDateWithPattern(date, format, lang, tz);
        },
    };
}

export const DATE_FORMULAS_CATEGORY = {
    label: 'Date',
    values: [
        { name: 'date', arrity: 0 },
        { name: 'dateRealtime', arrity: 0 },
        { name: 'toDateISO', arrity: 1 },
        {
            name: 'formatDate',
            arrity: 1,
            parameters: [
                { name: 'Date', type: 'string' },
                { name: 'Format', type: 'string' },
                { name: 'Locale', type: 'string' },
            ],
        },
        {
            name: 'fromTime',
            arrity: 1,
            parameters: [
                { name: 'Date', type: 'string' },
                { name: 'WithoutSuffix', type: 'boolean' },
                { name: 'Locale', type: 'string' },
            ],
        },
        {
            name: 'toTime',
            arrity: 1,
            parameters: [
                { name: 'Date', type: 'string' },
                { name: 'WithoutSuffix', type: 'boolean' },
                { name: 'Locale', type: 'string' },
            ],
        },
        {
            name: 'compareDate',
            arrity: 3,
            parameters: [
                { name: 'Date1', type: 'string' },
                { name: 'Date2', type: 'string' },
                { name: 'Precision', type: 'string' },
                { name: 'Float', type: 'boolean' },
            ],
        },
        { name: 'getSecond', arrity: 0 },
        { name: 'getMinute', arrity: 0 },
        { name: 'getHour', arrity: 0 },
        { name: 'getDay', arrity: 0 },
        { name: 'getDayOfWeek', arrity: 0 },
        { name: 'getMonth', arrity: 0 },
        { name: 'getYear', arrity: 0 },
        { name: 'getDayOfYear', arrity: 0, parameters: [{ name: 'Date', type: 'string' }] },
        { name: 'getWeekOfYear', arrity: 0, parameters: [{ name: 'Date', type: 'string' }] },
        { name: 'addSeconds', arrity: 2 },
        { name: 'addMinutes', arrity: 2 },
        { name: 'addHours', arrity: 2 },
        { name: 'addDays', arrity: 2 },
        { name: 'addMonths', arrity: 2 },
        { name: 'addYears', arrity: 2 },
        { name: 'setSecond', arrity: 2 },
        { name: 'setMinute', arrity: 2 },
        { name: 'setHour', arrity: 2 },
        { name: 'setDay', arrity: 2 },
        { name: 'setDayOfWeek', arrity: 2 },
        { name: 'setMonth', arrity: 2 },
        { name: 'setYear', arrity: 2 },
        { name: 'toTimestamp', arrity: 1 },
        { name: 'getBrowserTimezone', arrity: 0 },
        {
            name: 'convertDateTimezone',
            arrity: 2,
            parameters: [
                { name: 'Date', type: 'string' },
                { name: 'Timezone', type: 'string' },
                { name: 'Preserve', type: 'boolean' },
            ],
        },
        {
            name: 'formatDateTimezone',
            arrity: 3,
            parameters: [
                { name: 'Date', type: 'string' },
                { name: 'Format', type: 'string' },
                { name: 'Timezone', type: 'string' },
                { name: 'Locale', type: 'string' },
            ],
        },
        { name: 'now', arrity: 0, deprecated: true },
        { name: 'timestamp', arrity: 0, deprecated: true },
    ],
};
