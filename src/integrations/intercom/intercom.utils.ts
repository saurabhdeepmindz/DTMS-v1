import { IntercomClient, IntercomEnvironment } from 'intercom-client';

const REGION_ENVIRONMENTS: Record<string, string> = {
    us: IntercomEnvironment.UsProduction,
    eu: IntercomEnvironment.EuProduction,
    au: IntercomEnvironment.AuProduction,
};

export function getIntercomClient(connection: ConnectionConfig | undefined) {
    return new IntercomClient({
        token: connection?.accessToken,
        environment: REGION_ENVIRONMENTS[connection?.region ?? 'us'] ?? IntercomEnvironment.UsProduction,
        version: '2.14', // intercom-client@7.0.3 ceiling; bump to 2.16 when the SDK ships it
    });
}

// Coerce an editor-supplied filter value into the type Intercom's search DSL expects.
// Editor values arrive as strings for hardcoded input; bound values pass through as-is.
// IMPORTANT: do NOT numeric-coerce string/IN values — most Intercom fields (phone, email,
// id, external_id, owner_id) are strings, and phone/id values look numeric ("+1415...",
// zip codes). Only `>`/`<` (numbers & dates) and explicit true/false are coerced.
function coerceFilterValue(operator: string, value: any) {
    if (value === undefined || value === null) return value;
    if (operator === 'IN' || operator === 'NIN') {
        if (Array.isArray(value)) return value;
        return String(value)
            .split(',')
            .map(s => s.trim())
            .filter(Boolean);
    }
    if (typeof value !== 'string') return value; // bound number/boolean/etc — pass through
    if (value === 'true') return true;
    if (value === 'false') return false;
    if ((operator === '>' || operator === '<') && value !== '' && !Number.isNaN(Number(value))) return Number(value);
    return value;
}

// Build the Intercom search `query` from the editor's structured filters or raw DSL.
// `searchMode` ('filters' | 'raw') picks the input; when omitted, a non-empty `queryRaw`
// still wins for backward compatibility. Returns undefined when there is nothing to search on.
export function buildSearchQuery(args: Record<string, any> = {}) {
    const raw = args.queryRaw;
    const hasRaw = raw && typeof raw === 'object' && !Array.isArray(raw) && Object.keys(raw).length > 0;
    if (args.searchMode === 'raw') return hasRaw ? raw : undefined;
    if (args.searchMode !== 'filters' && hasRaw) return raw;

    const filters = Array.isArray(args.filters) ? args.filters.filter((f: any) => f && f.field && f.operator) : [];
    const clauses = filters.map((f: any) => ({
        field: f.field,
        operator: f.operator,
        value: coerceFilterValue(f.operator, f.value),
    }));
    if (clauses.length === 0) return undefined;
    if (clauses.length === 1) return clauses[0];
    return { operator: 'AND', value: clauses };
}

// Build the search `pagination` hash from defined values only, returning undefined when empty.
// Intercom's /tickets/search 500s on a pagination hash that lacks per_page (contacts and
// conversations tolerate it; tickets does not), so the key must be dropped entirely when unset.
export function buildPagination(args: Record<string, any> = {}) {
    const pagination: Record<string, any> = {};
    if (args.per_page !== undefined && args.per_page !== null && args.per_page !== '') {
        pagination.per_page = args.per_page;
    }
    if (args.starting_after) pagination.starting_after = args.starting_after;
    return Object.keys(pagination).length ? pagination : undefined;
}

// Event metadata is flat (max 10 keys) with string/number/boolean values, plus two nested
// exceptions: a rich link `{ url, value }` and a monetary amount `{ amount, currency }`.
// Intercom silently DROPS other nested objects/arrays and still answers 202, so validate up
// front and throw — otherwise track-event reports success for a dropped/partial event.
const ALLOWED_METADATA_SHAPES = [
    ['url', 'value'],
    ['amount', 'currency'],
];
export function assertFlatEventMetadata(metadata: any) {
    if (metadata === undefined || metadata === null) return;
    if (typeof metadata !== 'object' || Array.isArray(metadata)) {
        throw new Error('Intercom track-event metadata must be an object of key-value pairs.');
    }
    const keys = Object.keys(metadata);
    if (keys.length > 10) {
        throw new Error(
            `Intercom track-event metadata allows at most 10 keys (got ${keys.length}); extra keys are silently dropped.`
        );
    }
    const bad = keys.filter(key => {
        const value = metadata[key];
        if (value === null) return false;
        const type = typeof value;
        if (type === 'string' || type === 'number' || type === 'boolean') return false;
        if (type === 'object' && !Array.isArray(value)) {
            const vkeys = Object.keys(value);
            return !(vkeys.length && ALLOWED_METADATA_SHAPES.some(shape => vkeys.every(k => shape.includes(k))));
        }
        return true;
    });
    if (bad.length) {
        throw new Error(
            `Intercom track-event metadata must be flat — these keys have nested/array values Intercom silently drops: ${bad.join(', ')}. ` +
                'Allowed value types: string, number, boolean, a rich link { url, value }, or a monetary amount { amount, currency }.'
        );
    }
}
