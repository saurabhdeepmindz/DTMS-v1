import type { SupabaseFilterField, SupabaseSortConfig } from '../supabase.types.ts';
import { getFilterFieldPath } from './supabaseGuards.ts';
import { SupabaseColumns } from './supabaseColumns.ts';

type SupabaseOrderOptions = {
    ascending: boolean;
    referencedTable?: string;
};

export class SupabaseSorts {
    private readonly sort: SupabaseSortConfig[];

    constructor(sort?: SupabaseSortConfig[]) {
        this.sort = sort || [];
    }

    fieldPaths(): string[][] {
        const paths: string[][] = [];
        for (const item of this.sort) {
            const path = getFilterFieldPath(item.field);
            if (path.length) paths.push(path);
        }
        return paths;
    }

    withPrefix(prefix: string[]): SupabaseSorts {
        const path = prefix.filter((part): part is string => typeof part === 'string');
        if (!path.length) return new SupabaseSorts(this.sort);

        const sort: SupabaseSortConfig[] = [];
        for (const item of this.sort) {
            sort.push({ ...item, field: SupabaseSorts.prefixField(path, item.field) });
        }

        return new SupabaseSorts(sort);
    }

    applyTo<TQuery extends object>(query: TQuery, columns: SupabaseColumns): TQuery {
        for (const item of this.sort) {
            query = this.applySortItem(query, item, columns);
        }

        return query;
    }

    private applySortItem<TQuery extends object>(
        query: TQuery,
        item: SupabaseSortConfig,
        columns: SupabaseColumns
    ): TQuery {
        const resolvedField = columns.resolveField(item.field);
        if (!resolvedField.column) return query;

        const order = (query as {
            order?: (column: string, options: SupabaseOrderOptions) => TQuery;
        }).order;
        if (typeof order !== 'function') return query;

        const options = {
            ascending: item.direction !== 'DESC',
        };
        if (!resolvedField.scope) return order.call(query, resolvedField.column, options);

        return order.call(query, resolvedField.scopedColumn, {
            ...options,
            referencedTable: resolvedField.scope,
        });
    }

    private static prefixField(prefix: string[], field?: SupabaseFilterField): string[] {
        if (field === '') return [...prefix];
        return [...prefix, ...getFilterFieldPath(field)];
    }
}
