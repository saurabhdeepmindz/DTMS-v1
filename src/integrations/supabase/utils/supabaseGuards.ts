import type { SupabaseFilter, SupabaseFilterField, SupabaseFilterGroup } from '../supabase.types.ts';

export function isFilterGroup(filter?: SupabaseFilter): filter is SupabaseFilterGroup {
    return !!filter && 'conditions' in filter && Array.isArray(filter.conditions);
}

export function getFilterFieldPath(field?: SupabaseFilterField): string[] {
    if (Array.isArray(field)) return field.filter((part): part is string => typeof part === 'string');
    if (typeof field === 'string') return field.split('.');
    return [];
}
