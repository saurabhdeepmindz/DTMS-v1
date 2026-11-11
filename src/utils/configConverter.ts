type ColumnModeArray = {
    $mode: 'array';
    field: string;
};

type ColumnNode = true | ColumnModeArray | ColumnMap | '*';

type ColumnMap = {
    [key: string]: ColumnNode;
};

type RawFilter = {
    if?: boolean;
    field?: string | string[];
    operator?: string;
    value?: unknown;
    isEmptyIgnored?: boolean;
    link?: '$and' | '$or';
    conditions?: RawFilter[];
    alias?: string;
};

type RawSortItem = {
    field?: string | string[];
    direction?: string;
    ignoreCase?: boolean;
    key?: string;
    alias?: string;
};

type IncludeInput = {
    path?: string[];
    alias?: string;
    schema?: string;
    table: string;
    many?: boolean;
    joinType?: 'left' | 'inner';
    fromAlias?: string | null;
    on: { left: string; right: string };
    filters?: RawFilter;
    sort?: RawSortItem[];
};

type IncludeConfig = {
    alias: string;
    schema?: string;
    table: string;
    many?: boolean;
    joinType?: 'left' | 'inner';
    fromAlias?: string | null;
    on: { left: string; right: string };
    filters?: RawFilter;
    sort?: RawSortItem[];
};

type FrontendConfig = {
    table?: string;
    schema?: string;
    columns?: ColumnMap | '*';
    filters?: RawFilter | null;
    sort?: RawSortItem[];
    includes?: IncludeInput[];
    limit?: number;
    offset?: number;
    groupBy?: unknown;
    summaries?: unknown;
    cursor?: unknown;
    fetchGroupedRows?: boolean;
    groupingContext?: unknown;
};

export function convertConfig(frontendConfig: FrontendConfig) {
    const includes = normalizeIncludes(frontendConfig.includes);

    return {
        table: frontendConfig.table,
        schema: frontendConfig.schema,
        filters: frontendConfig.filters,
        sort: frontendConfig.sort,
        includes,
        columns: frontendConfig.columns,
        limit: frontendConfig.limit,
        offset: frontendConfig.offset,
        groupBy: frontendConfig.groupBy,
        summaries: frontendConfig.summaries,
        cursor: frontendConfig.cursor,
        fetchGroupedRows: frontendConfig.fetchGroupedRows,
        groupingContext: frontendConfig.groupingContext,
    };
}

function normalizeIncludes(includes: IncludeInput[] | undefined): IncludeConfig[] {
    if (!Array.isArray(includes)) return [];

    return includes.map(include => {
        const alias = include.alias || (include.path ? include.path.join('.') : undefined);
        if (!alias) {
            throw new Error('Include alias or path is required');
        }

        const fromAlias =
            include.fromAlias ?? (include.path && include.path.length > 1 ? include.path.slice(0, -1).join('.') : null);

        return {
            alias,
            schema: include.schema,
            table: include.table,
            many: include.many,
            joinType: include.joinType,
            fromAlias,
            on: include.on,
            filters: include.filters,
            sort: include.sort,
        };
    });
}
