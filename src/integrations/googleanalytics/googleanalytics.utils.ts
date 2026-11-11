import { analyticsdata, analyticsdata_v1beta, auth as analyticsDataAuth } from '@googleapis/analyticsdata';
import { analyticsadmin, auth as analyticsAdminAuth } from '@googleapis/analyticsadmin';

const SCOPES = ['https://www.googleapis.com/auth/analytics.readonly'];

function getCredentialsObject(connection: ConnectionConfig) {
    if (!connection?.clientEmail || !connection?.privateKey) {
        throw new Error(
            'Google Analytics connection is missing or incomplete (no client email / private key) — check the connectionId and the connection configuration.'
        );
    }

    return {
        type: 'service_account',
        client_email: connection.clientEmail,
        private_key: connection.privateKey?.replace(/\\n/g, '\n'),
        auth_uri: 'https://accounts.google.com/o/oauth2/auth',
        token_uri: 'https://oauth2.googleapis.com/token',
        auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
        universe_domain: 'googleapis.com',
    };
}

// NOTE: each SDK's GoogleAuth is constructed from that SDK's own `auth` export —
// @googleapis/analyticsdata and analyticsadmin bundle google-auth-library v11 (via
// googleapis-common@9) while the repo's top-level copy is v10, and the classes are
// nominally incompatible (#private members).
export function getAnalyticsDataClient(connection: ConnectionConfig) {
    const googleAuth = new analyticsDataAuth.GoogleAuth({
        credentials: getCredentialsObject(connection),
        scopes: SCOPES,
    });
    return analyticsdata({ version: 'v1beta', auth: googleAuth });
}

export function getAnalyticsAdminClient(connection: ConnectionConfig) {
    const googleAuth = new analyticsAdminAuth.GoogleAuth({
        credentials: getCredentialsObject(connection),
        scopes: SCOPES,
    });
    return analyticsadmin({ version: 'v1beta', auth: googleAuth });
}

// G3: users paste `G-XXXX` measurement IDs (from the site snippet) instead of the numeric
// property ID. Reject them with an instructional error; strip a `properties/` prefix.
export function normalizePropertyId(value: unknown): string {
    const raw = String(value ?? '').trim();
    if (!raw) {
        throw new Error('Missing Google Analytics property ID — select a property or provide its numeric ID.');
    }
    const stripped = raw.startsWith('properties/') ? raw.slice('properties/'.length) : raw;
    if (/^G-/i.test(stripped)) {
        throw new Error(
            `"${stripped}" is a measurement ID (the G-… identifier from your site's tracking snippet), not a property ID — use the numeric property ID from the property picker, or find it in GA4 under Admin → Property → Property details.`
        );
    }
    return stripped;
}

// G1/G2: report rows come back as parallel string arrays (dimensionValues/metricValues
// matched by index against dimensionHeaders/metricHeaders); an empty or thresholded
// report has NO `rows` key at all. Zip into flat objects, cast metric values to numbers.
export function zipReportRows(response: {
    dimensionHeaders?: analyticsdata_v1beta.Schema$DimensionHeader[] | null;
    metricHeaders?: analyticsdata_v1beta.Schema$MetricHeader[] | null;
    rows?: analyticsdata_v1beta.Schema$Row[] | null;
}): Record<string, string | number | null>[] {
    const dimensionNames = (response.dimensionHeaders || []).map(header => header.name);
    const metricNames = (response.metricHeaders || []).map(header => header.name);

    return (response.rows || []).map(row => {
        const zipped: Record<string, string | number | null> = {};
        dimensionNames.forEach((name, index) => {
            if (name) zipped[name] = row.dimensionValues?.[index]?.value ?? null;
        });
        metricNames.forEach((name, index) => {
            if (!name) return;
            const value = row.metricValues?.[index]?.value;
            zipped[name] = value == null ? null : Number(value);
        });
        return zipped;
    });
}

// A bound on/off does not always arrive as a boolean: a select wired to the field sends the
// STRING "false", which is truthy — a "Fewest sessions first" option sorted descending and
// no error ever said so (WW-5910 QA G-04). Only `true` and "true" mean yes.
export function toBoolean(value: unknown): boolean {
    return value === true || (typeof value === 'string' && value.trim().toLowerCase() === 'true');
}

// limit/offset reach the API as strings, and Google's answer to `offset=abc` is a 500
// "Invalid value at 'offset' (TYPE_INT64)" (WW-5910 QA G-02) — check the shape here and name
// the field. Empty means "not set" and returns undefined so the caller can apply its default.
export function toWholeNumber(value: unknown, field: string, { min = 0 }: { min?: number } = {}): number | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    const numeric = typeof value === 'number' ? value : Number(String(value).trim());
    if (!Number.isInteger(numeric) || numeric < min || String(value).trim() === '') {
        throw new Error(
            `"${field}" must be a whole number${min > 0 ? ` of at least ${min}` : ''}, but received ${JSON.stringify(value)}.`
        );
    }
    return numeric;
}

// The report table announces a 10,000-row page in the editor; accepting limit=50000 and
// echoing it back in the metadata told the caller more was coming than would ever arrive
// (WW-5910 QA G-02) — clamp once and report the number actually honored, as the Calendar
// table does with Google's 250 cap.
export const REPORT_TABLE_PAGE_MAX = 10000;

export function clampTableLimit(value: unknown, fallback = 100): number {
    const limit = toWholeNumber(value, 'limit', { min: 1 }) ?? fallback;
    return Math.min(limit, REPORT_TABLE_PAGE_MAX);
}

// GA4 date strings: YYYY-MM-DD, NdaysAgo, yesterday, today. Resolved to a UTC day for the
// pre-check below; anything else is left for Google to judge (undefined).
const ABSOLUTE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DAYS_AGO_PATTERN = /^(\d+)daysAgo$/i;

function resolveReportDate(value: unknown, now: Date): { day: number; relative: boolean } | undefined {
    if (typeof value !== 'string') return undefined;
    const raw = value.trim();
    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const DAY = 24 * 60 * 60 * 1000;
    if (/^today$/i.test(raw)) return { day: today, relative: true };
    if (/^yesterday$/i.test(raw)) return { day: today - DAY, relative: true };
    const daysAgo = DAYS_AGO_PATTERN.exec(raw);
    if (daysAgo) return { day: today - Number(daysAgo[1]) * DAY, relative: true };
    if (ABSOLUTE_DATE_PATTERN.test(raw)) {
        const parsed = Date.parse(`${raw}T00:00:00Z`);
        if (!Number.isNaN(parsed)) return { day: parsed, relative: false };
    }
    return undefined;
}

// The editor pre-fills End Date with `yesterday` (today's data is still partial), so a user
// who sets Start Date to `today` walks into Google's 400 "start_date must be less than or
// equal to end_date" (WW-5910 QA G-05). Say it before the call, and say what to change.
// Relative tokens resolve against the PROPERTY's time zone on Google's side; when one side
// is absolute and the other relative the two clocks can differ by a day around midnight, so
// that mix is only rejected when it is wrong by more than that.
export function assertDateRange(startDate: unknown, endDate: unknown, now = new Date()): void {
    const start = resolveReportDate(startDate, now);
    const end = resolveReportDate(endDate, now);
    if (!start || !end) return;
    const DAY = 24 * 60 * 60 * 1000;
    const slack = start.relative === end.relative ? 0 : DAY;
    if (start.day <= end.day + slack) return;
    const hint =
        /^today$/i.test(String(startDate).trim()) && /^yesterday$/i.test(String(endDate).trim())
            ? ' "End Date" defaults to yesterday because today\'s data is still being processed — set it to today as well to include today, or move "Start Date" back.'
            : ' Swap them, or widen the range.';
    throw new Error(
        `"Start Date" (${String(startDate).trim()}) is after "End Date" (${String(endDate).trim()}) — the range must run forwards.${hint}`
    );
}

// Realtime windows: `startMinutesAgo` is INCLUSIVE and 0 is the current minute, so "last 5
// minutes" is minutesAgo 0..4 — startMinutesAgo 4, not 5 (WW-5910 QA G-04: 5 returned six
// buckets). Standard properties cap the window at 29 (30 buckets).
export const REALTIME_MINUTES_MAX = 30;

export function toStartMinutesAgo(minutesLookback: unknown): number | undefined {
    if (minutesLookback === undefined || minutesLookback === null || minutesLookback === '') return undefined;
    const minutes = toWholeNumber(minutesLookback, 'minutesLookback', { min: 1 }) as number;
    return Math.min(minutes, REALTIME_MINUTES_MAX) - 1;
}

// The platform's error middleware turns an unhandled provider error into a 500 whatever
// Google said (WW-5994 QA C-11, WW-5910 QA G-02). Pull out Google's own message so a
// caller-side mistake at least reads as one. Undefined for anything that is not a Google
// 4xx — those stay genuine server errors and propagate untouched.
export function describeGoogleError(error: any): string | undefined {
    const status = error?.code ?? error?.response?.status;
    const message = error?.errors?.[0]?.message ?? error?.response?.data?.error?.message ?? error?.message;
    if (typeof status === 'number' && status >= 400 && status < 500 && message) return message;
    return undefined;
}

export type SimpleFilterRow = { field?: string; operator?: string; value?: string; caseSensitive?: unknown };

const STRING_MATCH_TYPES: Record<string, string> = {
    equals: 'EXACT',
    contains: 'CONTAINS',
    'begins with': 'BEGINS_WITH',
    'ends with': 'ENDS_WITH',
    'regexp full': 'FULL_REGEXP',
    'regexp partial': 'PARTIAL_REGEXP',
};

const NUMERIC_OPERATIONS: Record<string, string> = {
    '=': 'EQUAL',
    '>': 'GREATER_THAN',
    '>=': 'GREATER_THAN_OR_EQUAL',
    '<': 'LESS_THAN',
    '<=': 'LESS_THAN_OR_EQUAL',
};

// `Number('')` is 0, so a numeric operator with the value left empty silently filtered on
// "= 0" and answered zero rows with no error (WW-5910 QA G-04) — an empty value is a mistake.
function toNumericValue(value: unknown, field: string, operator: string): analyticsdata_v1beta.Schema$NumericValue {
    if (value === undefined || value === null || String(value).trim() === '') {
        throw new Error(`Filter "${field} ${operator}" needs a numeric value, but none was given.`);
    }
    const numeric = Number(value);
    if (Number.isNaN(numeric)) {
        throw new Error(`Filter "${field} ${operator}" needs a numeric value, but received ${JSON.stringify(value)}.`);
    }
    return Number.isInteger(numeric) ? { int64Value: String(numeric) } : { doubleValue: numeric };
}

function buildFilter(row: SimpleFilterRow): analyticsdata_v1beta.Schema$FilterExpression {
    const { field, operator = 'equals', value } = row;
    if (!field) {
        throw new Error('Each filter row needs a "field" — the API name of one of the selected dimensions.');
    }

    // Google matches strings case-INsensitively unless told otherwise; the flag is only sent
    // when set, so an untouched row keeps the API default (WW-5910 QA G-03).
    const caseSensitive = toBoolean(row.caseSensitive) ? true : undefined;

    let filter: analyticsdata_v1beta.Schema$Filter;
    if (operator in STRING_MATCH_TYPES) {
        filter = {
            fieldName: field,
            stringFilter: { matchType: STRING_MATCH_TYPES[operator], value: String(value ?? ''), caseSensitive },
        };
    } else if (operator in NUMERIC_OPERATIONS) {
        filter = {
            fieldName: field,
            numericFilter: { operation: NUMERIC_OPERATIONS[operator], value: toNumericValue(value, field, operator) },
        };
    } else if (operator === 'in list') {
        filter = {
            fieldName: field,
            inListFilter: {
                values: String(value ?? '')
                    .split(',')
                    .map(item => item.trim())
                    .filter(item => item !== ''),
                caseSensitive,
            },
        };
    } else if (operator === 'is empty') {
        filter = { fieldName: field, emptyFilter: {} };
    } else {
        throw new Error(
            `Unknown filter operator "${operator}" — expected one of: ${[
                ...Object.keys(STRING_MATCH_TYPES),
                'in list',
                ...Object.keys(NUMERIC_OPERATIONS),
                'is empty',
            ].join(', ')}.`
        );
    }

    return { filter };
}

// Config-sourced "arrays" are not guaranteed to be arrays: an untouched view/action field can
// persist as `{}` (truthy, so `x || []` keeps it) — WW-5910 dev QA hit "(simpleRows || []) is
// not iterable" on every fresh table view. Coerce hard.
export function toArray<T>(value: T[] | unknown): T[] {
    return Array.isArray(value) ? (value as T[]) : [];
}

// A raw FilterExpression counts only when it is a non-empty object — an untouched object
// field persists as `{}` and must read as "not set".
export function toRawFilter(value: unknown): analyticsdata_v1beta.Schema$FilterExpression | undefined {
    return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0
        ? (value as analyticsdata_v1beta.Schema$FilterExpression)
        : undefined;
}

// Simple `{field, operator, value}` rows AND-combined into one andGroup FilterExpression.
// A non-empty advancedFilter (raw FilterExpression JSON) wins and is passed through verbatim.
export function buildDimensionFilter(
    simpleRows: SimpleFilterRow[] | undefined,
    advancedFilter: analyticsdata_v1beta.Schema$FilterExpression | undefined
): analyticsdata_v1beta.Schema$FilterExpression | undefined {
    if (advancedFilter && typeof advancedFilter === 'object' && Object.keys(advancedFilter).length > 0) {
        return advancedFilter;
    }

    const rows = toArray<SimpleFilterRow>(simpleRows).filter(row => row && (row.field || row.operator || row.value));
    if (rows.length === 0) return undefined;
    if (rows.length === 1) return buildFilter(rows[0]);
    return { andGroup: { expressions: rows.map(buildFilter) } };
}

// G9: the dimensionFilter can only reference dimensions (metrics belong in metricFilter and
// vice versa) — Google's 400 for this is cryptic, so validate pre-flight for a clear error.
export function assertFilterFieldsAreDimensions(simpleRows: SimpleFilterRow[] | undefined, dimensions: string[]) {
    for (const row of toArray<SimpleFilterRow>(simpleRows)) {
        if (!row?.field) continue;
        if (!dimensions.includes(row.field)) {
            throw new Error(
                `Filter field "${row.field}" is not among the selected dimensions (${
                    dimensions.length ? dimensions.join(', ') : 'none selected'
                }). Filters can only reference selected dimensions — add "${row.field}" to the dimensions, or use the advanced metric filter for metric conditions.`
            );
        }
    }
}

export type SimpleOrderByRow = { field?: string; desc?: unknown };

// `{field, desc}` rows → metric/dimension orderBys; field matched against metrics first,
// then dimensions. `desc` goes through toBoolean: a bound "false" must sort ascending.
export function buildOrderBys(
    rows: SimpleOrderByRow[] | undefined,
    dimensions: string[],
    metrics: string[]
): analyticsdata_v1beta.Schema$OrderBy[] | undefined {
    const orderRows = toArray<SimpleOrderByRow>(rows).filter(row => row?.field);
    if (orderRows.length === 0) return undefined;

    return orderRows.map(row => {
        const field = row.field as string;
        const desc = toBoolean(row.desc);
        if (metrics.includes(field)) return { metric: { metricName: field }, desc };
        if (dimensions.includes(field)) return { dimension: { dimensionName: field }, desc };
        throw new Error(
            `Order-by field "${field}" is not among the selected dimensions or metrics (dimensions: ${
                dimensions.join(', ') || 'none'
            }; metrics: ${metrics.join(', ') || 'none'}).`
        );
    });
}
