import * as hubspot from '@hubspot/api-client';

export function getHubspotClient(connection?: ConnectionConfig) {
    return new hubspot.Client({ accessToken: connection?.accessToken });
}

// The editor emits '' / [] / {} for untouched optional fields — the HubSpot API rejects
// some of them (e.g. empty filterGroups entries), so normalize to undefined.
export function emptyToUndefined<T>(value: T): T | undefined {
    if (value === null || value === undefined || value === '') return undefined;
    if (Array.isArray(value) && value.length === 0) return undefined;
    if (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0) return undefined;
    return value;
}

// Create/update editors expose common properties as named top-level args plus a free-form
// `properties` object — merge them into the single properties payload HubSpot expects.
// Named args win on conflict; empty-string named args are dropped (the editor emits ''
// for untouched fields — clearing a property is done through the properties object).
export function mergeProperties(args: { [key: string]: any }, namedKeys: string[]): Record<string, any> {
    const properties: Record<string, any> = { ...(args.properties ?? {}) };
    for (const key of namedKeys) {
        if (args[key] !== undefined && args[key] !== null && args[key] !== '') properties[key] = args[key];
    }
    return properties;
}

export const CONTACT_PROPERTY_KEYS = ['email', 'firstname', 'lastname', 'phone', 'company', 'lifecyclestage', 'hubspot_owner_id'];
export const COMPANY_PROPERTY_KEYS = ['name', 'domain', 'city', 'state', 'country', 'industry', 'phone', 'hubspot_owner_id'];
export const DEAL_PROPERTY_KEYS = ['dealname', 'pipeline', 'dealstage', 'amount', 'closedate', 'hubspot_owner_id'];
export const TICKET_PROPERTY_KEYS = ['subject', 'hs_pipeline', 'hs_pipeline_stage', 'hs_ticket_priority', 'content', 'hubspot_owner_id'];

// The structured editor field always emits every filter sub-key (value/highValue/values),
// so untouched ones arrive as '' / []. Drop those, drop filters missing propertyName or
// operator, and drop groups left with no filters — HubSpot rejects empty/partial filters.
// A raw bound filterGroups flows through the same clean unchanged (same key shape).
function cleanFilter(filter: any): any {
    if (!filter || !filter.propertyName || !filter.operator) return undefined;
    const cleaned: Record<string, any> = { propertyName: filter.propertyName, operator: filter.operator };
    if (filter.value !== undefined && filter.value !== null && filter.value !== '') cleaned.value = filter.value;
    if (filter.highValue !== undefined && filter.highValue !== null && filter.highValue !== '') cleaned.highValue = filter.highValue;
    if (Array.isArray(filter.values)) {
        const values = filter.values.filter((v: any) => v !== undefined && v !== null && v !== '');
        if (values.length) cleaned.values = values;
    }
    return cleaned;
}

export function cleanFilterGroups(groups: any): any[] | undefined {
    if (!Array.isArray(groups)) return undefined;
    const cleaned = groups
        .map(group => {
            const filters = Array.isArray(group?.filters) ? group.filters.map(cleanFilter).filter(Boolean) : [];
            return filters.length ? { filters } : undefined;
        })
        .filter(Boolean);
    return cleaned.length ? cleaned : undefined;
}

// Same idea for sorts: drop rows the user added but never filled in (no propertyName).
export function cleanSorts(sorts: any): any[] | undefined {
    if (!Array.isArray(sorts)) return undefined;
    const cleaned = sorts.filter(sort => sort?.propertyName);
    return cleaned.length ? cleaned : undefined;
}

// Shared body for POST /crm/v3/objects/{type}/search. The SDK types `sorts` as string[]
// but the API accepts [{ propertyName, direction }] objects — hence the `any`.
export function buildSearchRequest(args: { [key: string]: any }): any {
    return {
        query: emptyToUndefined(args.query),
        filterGroups: cleanFilterGroups(args.filterGroups),
        sorts: cleanSorts(args.sorts),
        properties: emptyToUndefined(args.properties),
        limit: args.limit ?? undefined,
        after: emptyToUndefined(args.after),
    };
}
