export type SupabaseColumnObject = {
    [column: string]: SupabaseColumnSelection | string | undefined;
    $alias?: string;
    $relation?: string;
    $value?: SupabaseColumnSelection;
};
export type SupabaseColumnSelection = boolean | '*' | string[] | SupabaseColumnObject;
export type SupabaseColumnValue = SupabaseColumnSelection | string | undefined;
export type SupabaseJoinTypes = Record<string, 'inner' | string>;
type SupabaseFilterPrimitive = string | number | boolean | null;
export type SupabaseFilterValue =
    | SupabaseFilterPrimitive
    | SupabaseFilterValue[]
    | { [key: string]: SupabaseFilterValue };
export type SupabaseFilterField = string | string[];
export type SupabaseFilterOperator =
    | 'eq'
    | 'neq'
    | 'gt'
    | 'gte'
    | 'lt'
    | 'lte'
    | 'like'
    | 'ilike'
    | 'is'
    | 'in'
    | 'contains'
    | 'containedBy'
    | 'overlaps'
    | 'textSearch'
    | '$eq'
    | '$ne'
    | '$gt'
    | '$gte'
    | '$lt'
    | '$lte'
    | '$iLike:contains'
    | '$notILike:contains'
    | '$iLike:startsWith'
    | '$iLike:endsWith'
    | '$eq:null'
    | '$ne:null'
    | '$in'
    | '$notIn'
    | '$contains'
    | '$overlap'
    | '$notOverlap'
    | (string & {});
export type SupabaseFilterCondition = {
    field?: SupabaseFilterField;
    operator?: SupabaseFilterOperator;
    value?: SupabaseFilterValue;
    isEmptyIgnored?: boolean;
};
export type SupabaseFilterGroup = {
    if?: boolean;
    link?: '$and' | '$or' | string;
    conditions?: SupabaseFilter[];
};
export type SupabaseFilter = SupabaseFilterCondition | SupabaseFilterGroup;
export type SupabaseSortConfig = {
    field?: SupabaseFilterField;
    direction?: 'ASC' | 'DESC' | string;
};
export type SupabaseIncludeConfig = {
    path?: string[];
    filters?: SupabaseFilter;
    sort?: SupabaseSortConfig[];
    joinType?: 'left' | 'inner' | string;
};
export type SupabaseTableConfig = TableConfig<{
    table: string;
}>;
export type SupabaseViewConfig<TFilters = SupabaseFilter> = ViewConfig<
    SupabaseColumnSelection,
    TFilters,
    number,
    number
> & {
    includes?: SupabaseIncludeConfig[];
    joinTypes?: SupabaseJoinTypes;
    sort?: SupabaseSortConfig[];
    single?: boolean;
    maybeSingle?: boolean;
};
export type SupabaseSelectActionArgs = SupabaseViewConfig<SupabaseFilter> & {
    table: string;
};
export type SupabaseMutationActionArgs = {
    table: string;
    columns?: SupabaseColumnSelection;
    filters?: SupabaseFilter;
    data?: Record<string, unknown> | Array<Record<string, unknown>>;
    returnColumns?: string[];
    returnMode?: 'none' | string;
    count?: 'exact' | 'planned' | 'estimated' | null;
    onConflict?: string[];
    ignoreDuplicates?: boolean;
};
