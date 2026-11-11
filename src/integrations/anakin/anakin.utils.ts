import { setTimeout as sleep } from 'node:timers/promises';
import { getWorkflowSignal } from '../../services/workflowContext.service.ts';

const ANAKIN_API_BASE = 'https://api.anakin.io/v1';

// Workflow Try/Catch retains only name, message and cause. All local validation failures
// use the same status shape, including schema parsing, browser steps and bound values.
function invalidArgument(message: string): Error {
    return new Error(message, { cause: { code: 400, status: 400, reason: 'invalid_argument' } });
}

// Upper bound of the polling budget. A project's backend runs in a Lambda whose default
// timeout is 120 s (weweb-back BASE_SERVER_CONFIG): a wait that outlives the function loses
// the job id the caller already paid for, which is what the Get scrape job hand-off exists to
// prevent. 100 s leaves room for the submit call and the rest of the workflow. The editor field
// advertises the same bound (anakin/utils/common-fields.ts) — keep the two in sync.
export const MAX_WAIT_SECONDS = 100;

// X-Source tags the traffic as the WeWeb integration on Anakin's side (attribution only,
// case-sensitive `we-web`). Required on EVERY request, including polling GETs.
export function getHeaders(connection: ConnectionConfig | undefined) {
    if (!connection?.apiKey) {
        throw invalidArgument(
            'Anakin connection is missing or incomplete (no API key) — check the connectionId and the connection configuration.'
        );
    }
    return {
        'X-API-Key': connection.apiKey,
        'X-Source': 'we-web',
        'Content-Type': 'application/json',
    };
}

export type AnakinApiCause = { code: number; status: number; reason?: string; body?: unknown };
export type AnakinApiError = Error & {
    code: number;
    status: number;
    reason?: string;
    body?: unknown;
    cause: AnakinApiCause;
};

// A rejected call must reach the workflow as a real Error WITH A `cause`: the workflow core
// keeps only `name`, `message` and `cause` of a thrown Error (workflow.core.js), so the HTTP
// status lives under `cause.code` — the same place Google's client puts it, which is what the
// Try/Catch recipe (`caughtError.cause.code`) reads. Anakin's own code (`insufficient_credits`,
// `invalid_request`) leads the message. A body that is not JSON — a gateway or firewall page —
// is named as such instead of surfacing as "Unexpected token <", so the caller knows no job
// was read. The top-level `code`/`status` are kept for in-process callers.
export function buildAnakinError(status: number, data: unknown, text: string): AnakinApiError {
    const body = data as { error?: unknown; message?: unknown } | undefined;
    const reason = typeof body?.error === 'string' ? body.error : undefined;
    const trimmed = text.trim();
    const detail =
        typeof body?.message === 'string'
            ? body.message
            : trimmed.startsWith('<')
              ? 'non-JSON (HTML) response — a gateway or firewall page, not Anakin'
              : trimmed.slice(0, 300) || 'empty response';
    const message = reason ? `${reason}: ${detail}` : `Anakin answered HTTP ${status}: ${detail}`;
    const cause: AnakinApiCause = { code: status, status, reason, body: data ?? trimmed };
    const error = new Error(message, { cause }) as AnakinApiError;
    error.code = status;
    error.status = status;
    error.reason = reason;
    error.body = data ?? trimmed;
    return error;
}

export async function anakinFetch(
    connection: ConnectionConfig | undefined,
    path: string,
    init: { method?: string; body?: Record<string, unknown> } = {}
): Promise<Record<string, any>> {
    const response = await fetch(`${ANAKIN_API_BASE}${path}`, {
        method: init.method ?? 'GET',
        headers: getHeaders(connection),
        ...(init.body ? { body: JSON.stringify(init.body) } : {}),
    });
    const text = await response.text();
    let data: unknown;
    try {
        data = text ? JSON.parse(text) : undefined;
    } catch {
        data = undefined;
    }
    if (!response.ok || data === undefined) throw buildAnakinError(response.status, data, text);
    return data as Record<string, any>;
}

// `typeof []` is "object" and `typeof null` is "object", which makes type errors read as
// self-contradictory ("must be an object, received object"). Name what it actually is.
function describeType(value: unknown): string {
    if (Array.isArray(value)) return 'array';
    if (value === null) return 'null';
    return typeof value;
}

// Editor `onoff` fields emit real booleans, but a BOUND value can arrive as a string
// ("false" from a URL param, an env variable, a table column). Plain truthiness reads
// "false" as true — and for these two flags that silently switches on a paid option
// (+1 browser, +2 JSON extraction). Interpret the unambiguous forms, reject the rest.
export function toBoolean(value: unknown, fieldName: string): boolean {
    if (value === undefined || value === null || value === '') return false;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number' && (value === 0 || value === 1)) return value === 1;
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (normalized === 'true' || normalized === '1') return true;
        if (normalized === 'false' || normalized === '0') return false;
    }
    throw invalidArgument(
        `"${fieldName}" must be true or false, but received ${describeType(value)} (${JSON.stringify(value)}).`
    );
}

// Config-sourced "arrays" are not guaranteed to be arrays: an untouched action field can
// persist as `{}` (truthy, so `x || []` keeps it). That empty placeholder is the ONLY
// tolerated non-array. A wrong-typed value that actually carries content (a bare string, a
// number, a populated object) is a real mistake and must fail loudly: coercing it to [] would
// still bill a credit and return a normal-looking job that silently lacks what was asked for.
export function toArray<T>(value: T[] | unknown, fieldName?: string): T[] {
    if (Array.isArray(value)) return value as T[];
    if (value === undefined || value === null || value === '') return [];
    if (typeof value === 'object' && Object.keys(value as Record<string, unknown>).length === 0) return [];
    throw invalidArgument(
        `"${fieldName ?? 'value'}" must be a list, but received ${describeType(value)} (${JSON.stringify(value)}). ` +
            `Pass a list of values, or leave the field empty.`
    );
}

// Sleeps for `ms` unless the workflow is aborted first (cancelled run, scheduled task over
// its limit). Resolves false on abort so the poll loop can hand the job back at once instead
// of sleeping until its own deadline, like the native Wait action does.
async function sleepUnlessAborted(ms: number): Promise<boolean> {
    const signal = getWorkflowSignal();
    if (signal?.aborted) return false;
    try {
        await sleep(ms, undefined, { signal });
        return true;
    } catch (error) {
        if ((error as { name?: string })?.name === 'AbortError') return false;
        throw error;
    }
}

// Poll GET /url-scraper/{id} until the job settles, the wait budget runs out, or the
// workflow is aborted. Polling is free and not rate-limited. In the last two cases the LAST
// poll body is returned (non-terminal status + id) so the caller can hand off to get-scrape-job.
export async function pollScrapeJob(
    connection: ConnectionConfig | undefined,
    jobId: string,
    maxWaitSeconds: number
): Promise<Record<string, unknown>> {
    const INTERVAL_MS = 2500;
    const MAX_CONSECUTIVE_POLL_FAILURES = 3;
    const deadline = Date.now() + maxWaitSeconds * 1000;
    let lastJob: Record<string, unknown> = { id: jobId, status: 'pending' };
    let consecutiveFailures = 0;

    // Jobs typically settle in 3–15 s; first check comes quickly, then steady interval.
    if (!(await sleepUnlessAborted(1500))) return lastJob;
    for (;;) {
        // The submit has already been billed at this point, and polling is free. A single
        // gateway blip (5xx, or an HTML error page that fails to parse as JSON) must not
        // throw away a job the caller paid for — retry a few times, and if it still will
        // not poll, hand back the id so Get scrape job can recover the result.
        try {
            lastJob = await anakinFetch(connection, `/url-scraper/${encodeURIComponent(jobId)}`);
            consecutiveFailures = 0;
        } catch (error) {
            consecutiveFailures += 1;
            if (consecutiveFailures >= MAX_CONSECUTIVE_POLL_FAILURES) return lastJob;
            if (!(await sleepUnlessAborted(INTERVAL_MS))) return lastJob;
            if (Date.now() > deadline) return lastJob;
            continue;
        }

        if (lastJob.status === 'completed' || lastJob.status === 'failed') return lastJob;
        if (Date.now() + INTERVAL_MS > deadline) return lastJob;
        if (!(await sleepUnlessAborted(INTERVAL_MS))) return lastJob;
    }
}

// Omitted → the action's default budget. Supplied but not a number → loud error, because
// silently falling back to the default hides that the caller's budget was ignored.
export function clampWaitSeconds(value: unknown, fallback: number): number {
    if (value === undefined || value === null || value === '') return fallback;
    // Gate on the type BEFORE Number(): it turns `true` into 1 and `[90]` into 90, which
    // would slip a wrong-typed value through as a plausible budget.
    const numeric = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN;
    if (Number.isNaN(numeric)) {
        throw invalidArgument(
            `"maxWaitSeconds" must be a number of seconds, but received ${describeType(value)} (${JSON.stringify(value)}). ` +
                `Omit it to use the default of ${fallback} s.`
        );
    }
    // Out of range is clamped, as the field promises — a bound 0 means "the minimum", not
    // "whatever the default is". The upper bound is the Lambda-safe MAX_WAIT_SECONDS.
    return Math.min(Math.max(numeric, 5), MAX_WAIT_SECONDS);
}

// Anakin publishes an exact two-letter allowlist and answers anything else with a generic
// 400. The editor's dropdown cannot produce a bad value, but a BOUND one can ("France",
// "FR ", an array) — normalise the harmless forms and name the fix for the rest.
export function normalizeCountry(value: unknown): string | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    if (typeof value !== 'string') {
        throw invalidArgument(
            `"country" must be a two-letter country code, but received ${describeType(value)} (${JSON.stringify(value)}).`
        );
    }
    const code = value.trim().toLowerCase();
    if (!/^[a-z]{2}$/.test(code)) {
        throw invalidArgument(
            `"country" must be a two-letter ISO 3166-1 code such as "fr" or "us", but received ${JSON.stringify(value)}.`
        );
    }
    return code;
}

// Same discipline for the webhook: Anakin only accepts an absolute http(s) URL here, and a
// bound number or relative path would come back as the same generic 400.
export function normalizeWebhookUrl(value: unknown): string | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    if (typeof value !== 'string') {
        throw invalidArgument(
            `"webhook_url" must be a string URL, but received ${describeType(value)} (${JSON.stringify(value)}).`
        );
    }
    const url = value.trim();
    if (!/^https?:\/\//i.test(url)) {
        throw invalidArgument(
            `"webhook_url" must be an absolute http/https URL (e.g. https://your-app.com/hooks/anakin), but received ${JSON.stringify(value)}.`
        );
    }
    return url;
}

export type BrowserStepRow = { type?: string; selector?: string; value?: string };

const STEP_TYPES = ['wait', 'wait_for', 'click', 'scroll', 'write', 'press'];

// Editor rows are `{type, selector, value}`; the API wants per-type shapes. Anakin's own
// limits (max 15 steps, each wait ≤ 15 s, total waits ≤ 30 s, selector ≤ 500 chars) are
// enforced pre-flight because their violation response is a generic 400.
export function mapBrowserSteps(rows: BrowserStepRow[] | unknown): Record<string, unknown>[] {
    const allRows = toArray<BrowserStepRow>(rows, 'actions');

    // A row that is not a {type, selector, value} object — a bare string like "wait 5000",
    // or an object using different key names — would otherwise fall through the blank
    // filter below and vanish: the scrape still runs and is billed, but without the steps
    // and without the useBrowser they imply. Reject the row instead.
    allRows.forEach((row, index) => {
        if (row === undefined || row === null) return;
        if (typeof row !== 'object' || Array.isArray(row)) {
            throw invalidArgument(
                `Browser step ${index + 1} must be an object with { type, selector, value }, but received ` +
                    `${describeType(row)} (${JSON.stringify(row)}).`
            );
        }
        const keys = Object.keys(row);
        if (keys.length > 0 && !('type' in row) && !('selector' in row) && !('value' in row)) {
            throw invalidArgument(
                `Browser step ${index + 1} has none of the expected keys { type, selector, value } — got ` +
                    `{ ${keys.join(', ')} }.`
            );
        }
    });

    const steps = allRows.filter(row => row && (row.type || row.selector || row.value));
    if (steps.length === 0) return [];
    if (steps.length > 15) {
        throw invalidArgument(`Browser steps: ${steps.length} steps given, but Anakin allows at most 15 per scrape.`);
    }

    let totalWaitMs = 0;
    const mapped = steps.map((row, index) => {
        const label = `Browser step ${index + 1} (${row.type || 'no type'})`;
        const requireSelector = () => {
            const selector = String(row.selector ?? '').trim();
            if (!selector) throw invalidArgument(`${label}: a CSS selector is required.`);
            if (selector.length > 500) throw invalidArgument(`${label}: selector exceeds 500 characters.`);
            return selector;
        };
        const requireWaitMs = (raw: unknown) => {
            const ms = Number(raw);
            if (Number.isNaN(ms) || ms < 1 || ms > 15000) {
                throw invalidArgument(`${label}: value must be a wait duration in milliseconds between 1 and 15000.`);
            }
            totalWaitMs += ms;
            return ms;
        };

        switch (row.type) {
            case 'wait':
                return { type: 'wait', milliseconds: requireWaitMs(row.value) };
            case 'wait_for': {
                const selector = requireSelector();
                const value = String(row.value ?? '').trim();
                return value
                    ? { type: 'wait_for', selector, milliseconds: requireWaitMs(value) }
                    : { type: 'wait_for', selector };
            }
            case 'click':
                return { type: 'click', selector: requireSelector() };
            case 'scroll': {
                const direction = String(row.value ?? '').trim() || 'down';
                if (direction !== 'up' && direction !== 'down') {
                    throw invalidArgument(`${label}: value must be "up" or "down" (scroll direction).`);
                }
                const selector = String(row.selector ?? '').trim();
                return { type: 'scroll', direction, ...(selector ? { selector } : {}) };
            }
            case 'write': {
                const text = String(row.value ?? '');
                if (!text) throw invalidArgument(`${label}: value must contain the text to type.`);
                if (text.length > 1000) throw invalidArgument(`${label}: text exceeds 1000 characters.`);
                return { type: 'write', text };
            }
            case 'press': {
                const key = String(row.value ?? '').trim();
                if (!key) throw invalidArgument(`${label}: value must contain the key to press (e.g. Enter, Tab).`);
                return { type: 'press', key };
            }
            default:
                throw invalidArgument(`${label}: unknown type — expected one of: ${STEP_TYPES.join(', ')}.`);
        }
    });

    if (totalWaitMs > 30000) {
        throw invalidArgument(
            `Browser steps: total wait time is ${totalWaitMs} ms, but Anakin caps the sum of all waits at 30000 ms.`
        );
    }
    return mapped;
}

// An empty object is the untouched-field placeholder and simply means "no extraction".
// Anything that is not an object (e.g. a JSON *string* from a js binding) is a mistake:
// dropping it silently would skip the extraction AND the generateJson it implies, returning
// a billed, normal-looking job with no generatedJson at all.
function normalizeOutputSchema(value: unknown): Record<string, unknown> | undefined {
    if (value === undefined || value === null || value === '') return undefined;

    // A js binding on this field commonly yields the schema as a JSON *string* — parse it
    // rather than reject it, matching how ai-gateway handles its own schema arg
    // (generate-text.action.ts). Anything that still isn't a plain object is a real mistake.
    let parsed: unknown = value;
    if (typeof value === 'string') {
        try {
            parsed = JSON.parse(value);
        } catch {
            throw invalidArgument(
                `"outputSchema" must be a JSON Schema object, but received a string that is not valid JSON ` +
                    `(${JSON.stringify(value)}). Bind an object, or a JSON string that parses to one.`
            );
        }
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw invalidArgument(
            `"outputSchema" must be a JSON Schema object, but received ${describeType(parsed)} ` +
                `(${JSON.stringify(parsed)}).`
        );
    }
    const schema = parsed as Record<string, unknown>;
    if (Object.keys(schema).length === 0) return undefined;
    // Anakin accepts any object, bills the extraction and answers free-form JSON when it is not a real
    // schema — refuse `{ "title": "string" }`-style values before the call (QA round 2, F-4).
    const properties = schema.properties;
    if (schema.type !== 'object' || !properties || typeof properties !== 'object' || Array.isArray(properties)) {
        throw invalidArgument(
            '"outputSchema" must describe an object: add "type": "object" and a "properties" map, e.g. ' +
                '{ "type": "object", "properties": { "title": { "type": "string" } } }.'
        );
    }
    return schema;
}

// Shared submit-body builder for scrape-url and start-scrape-job (explicit mapping only).
// Non-empty browser steps imply useBrowser; a non-empty outputSchema implies generateJson.
export function buildScrapeSubmitBody(args: { [key: string]: any | undefined }): Record<string, unknown> {
    if (!args.url) throw invalidArgument('Missing "url" — provide the HTTP/HTTPS URL to scrape.');
    if (typeof args.url !== 'string') {
        throw invalidArgument(
            `"url" must be a string, but received ${describeType(args.url)} (${JSON.stringify(args.url)}). ` +
                `Anakin rejects a non-string url with a generic "Invalid JSON body".`
        );
    }

    const formats = toArray<string>(args.formats, 'formats').filter(format => String(format ?? '').trim() !== '');
    const notAString = formats.findIndex(format => typeof format !== 'string');
    if (notAString !== -1) {
        throw invalidArgument(
            `"formats" entry ${notAString + 1} must be a string, but received ` +
                `${describeType(formats[notAString])} (${JSON.stringify(formats[notAString])}).`
        );
    }

    const steps = mapBrowserSteps(args.actions);
    const outputSchema = normalizeOutputSchema(args.outputSchema);
    const useBrowser = toBoolean(args.useBrowser, 'useBrowser');
    const generateJson = toBoolean(args.generateJson, 'generateJson');
    const country = normalizeCountry(args.country);

    return {
        url: args.url,
        ...(formats.length > 0 ? { formats } : {}),
        ...(country ? { country } : {}),
        ...(useBrowser || steps.length > 0 ? { useBrowser: true } : {}),
        ...(generateJson || outputSchema ? { generateJson: true } : {}),
        ...(outputSchema ? { outputSchema } : {}),
        ...(steps.length > 0 ? { actions: steps } : {}),
    };
}
