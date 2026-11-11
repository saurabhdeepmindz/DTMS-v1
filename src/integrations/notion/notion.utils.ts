import { Client } from '@notionhq/client';

// The editor emits '' / [] / {} / null for cleared or unbound fields; the Notion API
// rejects them on cursors and filters ("body failed validation"). Strip them from
// request param maps before the SDK call (same lesson as stripe's compactStripeParams).
export function compactNotionParams<T extends Record<string, any>>(params: T): T {
    const compacted: Record<string, any> = {};
    for (const [key, value] of Object.entries(params)) {
        const cleaned = compactValue(value);
        if (cleaned !== undefined) compacted[key] = cleaned;
    }
    // Keys are only ever removed, so the result still satisfies the call site's param shape.
    return compacted as T;
}

function compactValue(value: unknown): unknown {
    if (value === undefined || value === null || value === '') return undefined;
    if (Array.isArray(value)) {
        const items = value.map(compactValue).filter(item => item !== undefined);
        return items.length ? items : undefined;
    }
    if (typeof value === 'object') {
        const entries = Object.entries(value as Record<string, unknown>)
            .map(([key, item]) => [key, compactValue(item)] as const)
            .filter(([, item]) => item !== undefined);
        return entries.length ? Object.fromEntries(entries) : undefined;
    }
    return value;
}

async function getPropertyTypes(notion: Client, dataSourceId: string): Promise<Record<string, string>> {
    const schema: any = await notion.dataSources.retrieve({ data_source_id: dataSourceId });
    const propertyTypes: Record<string, string> = {};
    for (const [name, prop] of Object.entries(schema?.properties ?? {})) {
        propertyTypes[name] = (prop as any).type;
    }
    return propertyTypes;
}

/**
 * Converts the editor's flat property values into Notion's typed property-value format.
 * Types are derived from the data source schema, so the editor doesn't have to ship them.
 * If the data source is unknown, or a value is already in Notion format, it is passed through.
 */
export async function resolveNotionProperties(
    notion: Client,
    dataSourceId: string | undefined,
    properties: Record<string, any> | undefined
): Promise<Record<string, any>> {
    if (!properties || !Object.keys(properties).length) return properties ?? {};
    if (!dataSourceId) return properties;
    const propertyTypes = await getPropertyTypes(notion, dataSourceId);
    return convertToNotionProperties(properties, propertyTypes);
}

export function convertToNotionProperties(
    properties: Record<string, any>,
    propertyTypes: Record<string, string>
): Record<string, any> {
    if (!properties || !propertyTypes) return properties ?? {};

    const result: Record<string, any> = {};
    for (const [key, value] of Object.entries(properties)) {
        const type = propertyTypes[key];
        if (!type) {
            result[key] = value;
            continue;
        }
        const converted = convertProperty(value, type);
        if (converted !== undefined) {
            result[key] = converted;
        }
    }
    return result;
}

function convertProperty(value: any, type: string): any {
    // Value already in Notion property-value format (e.g. a directly bound object) — pass through.
    if (value !== null && typeof value === 'object' && !Array.isArray(value) && type in value) {
        return value;
    }
    switch (type) {
        case 'title':
            return { title: [{ text: { content: String(value ?? '') } }] };
        case 'rich_text':
            return { rich_text: [{ text: { content: String(value ?? '') } }] };
        case 'number':
            return { number: value != null ? Number(value) : null };
        case 'select':
            return value ? { select: { name: String(value) } } : { select: null };
        case 'multi_select':
            return { multi_select: (Array.isArray(value) ? value : []).map((v: any) => ({ name: String(v) })) };
        case 'date':
            return value ? { date: { start: String(value) } } : { date: null };
        case 'checkbox':
            return { checkbox: !!value };
        case 'url':
            return { url: value ? String(value) : null };
        case 'email':
            return { email: value ? String(value) : null };
        case 'phone_number':
            return { phone_number: value ? String(value) : null };
        case 'relation':
            return { relation: (Array.isArray(value) ? value : []).map((id: any) => ({ id: String(id) })) };
        case 'people':
            return { people: (Array.isArray(value) ? value : []).map((id: any) => ({ id: String(id) })) };
        case 'status':
            return value ? { status: { name: String(value) } } : { status: null };
        default:
            return undefined;
    }
}
