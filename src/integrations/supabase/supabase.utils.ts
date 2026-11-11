import { createClient } from '@supabase/supabase-js';

export { SupabaseColumns } from './utils/supabaseColumns.ts';
export { SupabaseFilters } from './utils/supabaseFilters.ts';
export { SupabaseQueryBuilder } from './utils/supabaseQueryBuilder.ts';
export { SupabaseRelation } from './utils/supabaseRelation.ts';
export { SupabaseSorts } from './utils/supabaseSorts.ts';
export type { ResolvedSupabaseField } from './utils/supabaseColumns.ts';
export type { SupabaseQueryConfig } from './utils/supabaseQueryBuilder.ts';

export function processSupabaseObjectData(
    actionData: Record<string, unknown> = {},
    tableLinkData: Record<string, unknown> = {}
): Record<string, unknown> {
    const data: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(tableLinkData)) {
        data[key] = value;
    }

    for (const [key, value] of Object.entries(actionData)) {
        if (value !== undefined && value !== null && value !== '') {
            data[key] = value;
        } else if (!Object.hasOwn(data, key)) {
            data[key] = value;
        }
    }

    return data;
}

export function getSupabaseClient(connection: ConnectionConfig) {
    const url = connection?.customDomain || `https://${connection?.branchRef || connection?.projectRef}.supabase.co`;
    return createClient(url, connection?.secretKey);
}
