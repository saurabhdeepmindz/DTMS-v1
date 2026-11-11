import type {
    SupabaseColumnSelection,
    SupabaseFilter,
    SupabaseIncludeConfig,
    SupabaseJoinTypes,
    SupabaseSortConfig,
} from '../supabase.types.ts';
import { SupabaseColumns } from './supabaseColumns.ts';
import { SupabaseFilters } from './supabaseFilters.ts';
import { SupabaseSorts } from './supabaseSorts.ts';

export type SupabaseQueryConfig = {
    columns?: SupabaseColumnSelection;
    filters?: SupabaseFilter;
    includes?: SupabaseIncludeConfig[];
    joinTypes?: SupabaseJoinTypes;
    sort?: SupabaseSortConfig[];
    limit?: number;
    offset?: number;
    single?: boolean;
    maybeSingle?: boolean;
};

type SupabasePaginationQuery<TQuery> = {
    limit(limit: number): TQuery;
    range(from: number, to: number): TQuery;
};
type SupabaseSingleResultQuery = {
    single(): unknown;
    maybeSingle(): unknown;
};

export class SupabaseQueryBuilder {
    readonly columns: SupabaseColumns;
    readonly filters: SupabaseFilters;
    readonly sorts: SupabaseSorts;
    private readonly config: SupabaseQueryConfig;

    constructor(config: SupabaseQueryConfig = {}) {
        this.config = config;
        this.filters = new SupabaseFilters(config.filters);
        this.sorts = new SupabaseSorts(config.sort);
        this.columns = new SupabaseColumns(SupabaseColumns.withRelationPaths(config.columns, this.getRelationPaths()));
    }

    get joinTypes(): SupabaseJoinTypes {
        const joinTypes = this.filters.withJoinTypes(this.columns, this.config.joinTypes);
        this.expandInnerJoinTypes(joinTypes);

        for (const include of this.config.includes || []) {
            const pathKey = this.getIncludePathKey(include);
            if (pathKey && include.joinType === 'inner') this.addInnerJoinPath(joinTypes, pathKey);
        }

        return joinTypes;
    }

    get selectString(): string {
        return this.columns.toSelectString(this.joinTypes);
    }

    applyFilters<TQuery extends object>(query: TQuery): TQuery {
        query = this.filters.applyTo(query, this.columns);

        for (const include of this.config.includes || []) {
            if (!include.path?.length || !include.filters) continue;
            query = new SupabaseFilters(include.filters).withPrefix(include.path).applyTo(query, this.columns);
        }

        return query;
    }

    applySort<TQuery extends object>(query: TQuery): TQuery {
        query = this.sorts.applyTo(query, this.columns);

        for (const include of this.config.includes || []) {
            if (!include.path?.length || !include.sort?.length) continue;
            query = new SupabaseSorts(include.sort).withPrefix(include.path).applyTo(query, this.columns);
        }

        return query;
    }

    applyActionPagination<TQuery extends SupabasePaginationQuery<TQuery>>(query: TQuery): TQuery {
        if (this.config.limit && this.config.offset) return query.range(this.config.offset, this.config.offset + this.config.limit - 1);
        if (this.config.limit) return query.limit(this.config.limit);
        return query;
    }

    applyTableViewPagination<TQuery extends SupabasePaginationQuery<TQuery>>(query: TQuery): TQuery {
        if (this.config.limit) query = query.limit(this.config.limit);
        if (this.config.limit && this.config.offset) return query.range(this.config.offset, this.config.offset + this.config.limit - 1);
        return query;
    }

    applySingleResult<TQuery extends SupabaseSingleResultQuery>(query: TQuery): TQuery {
        if (this.config.single) return query.single() as TQuery;
        if (this.config.maybeSingle) return query.maybeSingle() as TQuery;
        return query;
    }

    private getIncludePathKey(include: SupabaseIncludeConfig): string {
        return include.path?.filter((part): part is string => typeof part === 'string').join('.') || '';
    }

    private getRelationPaths(): string[][] {
        const paths: string[][] = [];

        for (const path of this.filters.fieldPaths()) {
            paths.push(SupabaseQueryBuilder.getFieldRelationPath(path));
        }

        for (const path of this.sorts.fieldPaths()) {
            paths.push(SupabaseQueryBuilder.getFieldRelationPath(path));
        }

        for (const include of this.config.includes || []) {
            const includePath = SupabaseQueryBuilder.getPath(include.path);
            if (includePath.length) paths.push(includePath);

            const filters = new SupabaseFilters(include.filters).withPrefix(includePath);
            for (const path of filters.fieldPaths()) {
                paths.push(SupabaseQueryBuilder.getFieldRelationPath(path));
            }

            const sorts = new SupabaseSorts(include.sort).withPrefix(includePath);
            for (const path of sorts.fieldPaths()) {
                paths.push(SupabaseQueryBuilder.getFieldRelationPath(path));
            }
        }

        for (const key of Object.keys(this.config.joinTypes || {})) {
            paths.push(key.split('.').filter(Boolean));
        }

        return paths.filter(path => path.length);
    }

    private static getPath(path?: string[]): string[] {
        return path?.filter((part): part is string => typeof part === 'string') || [];
    }

    private static getFieldRelationPath(path: string[]): string[] {
        return path.slice(0, -1).filter(part => part.includes('__'));
    }

    private expandInnerJoinTypes(joinTypes: SupabaseJoinTypes) {
        for (const [pathKey, joinType] of Object.entries({ ...joinTypes })) {
            if (joinType === 'inner') this.addInnerJoinPath(joinTypes, pathKey);
        }
    }

    private addInnerJoinPath(joinTypes: SupabaseJoinTypes, pathKey: string) {
        const path = pathKey.split('.').filter(Boolean);
        for (let index = 1; index <= path.length; index += 1) {
            joinTypes[path.slice(0, index).join('.')] = 'inner';
        }
    }
}
