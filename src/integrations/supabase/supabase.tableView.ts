import {
    getSupabaseClient,
    SupabaseQueryBuilder,
} from './supabase.utils.ts';
import type { SupabaseTableConfig, SupabaseViewConfig } from './supabase.types.ts';

global.registerTableView<ConnectionConfig, SupabaseTableConfig, SupabaseViewConfig>(
    'supabase',
    async (connection, table, view) => {
        const client = getSupabaseClient(connection);

        view.offset ||= 0;

        const queryBuilder = new SupabaseQueryBuilder(view);
        let query = client.from(table.table).select(queryBuilder.selectString, { count: view.count ?? 'exact' });

        query = queryBuilder.applyFilters(query);
        query = queryBuilder.applySort(query);
        query = queryBuilder.applyTableViewPagination(query);
        const { data, error, count } = await query;
        const nextOffset = view.offset + (data?.length || 0);

        if (error) throw error;
        return {
            data: data || [],
            metadata: {
                limit: view.limit || null,
                offset: view.offset,
                nextOffset: nextOffset >= count ? null : nextOffset,
                total: count || null,
            },
        };
    }
);
