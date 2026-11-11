import { escapeIdentifier } from 'pg';

export type QueryFormat = 'pretty' | 'min';

const INDENT_SIZE = 4;

type FormatOption = {
    format?: QueryFormat;
};

export type DatabaseColumnSchema = {
    type?: string;
};

export type DatabaseTableSchema = {
    schema?: string;
    name?: string;
    columns?: Record<string, DatabaseColumnSchema>;
};

export type DatabaseSchema = {
    tables?: Record<string, DatabaseTableSchema>;
};

export type IncludeOn = {
    left: string;
    right: string;
};

export type IncludeConfig = {
    schema?: string;
    table: string;
    many?: boolean;
    joinType?: 'left' | 'inner';
    path?: string[];
    alias?: string;
    sqlAlias?: string;
    fromSqlAlias?: string | null;
    index?: number;
    fromAlias?: string | null;
    on?: IncludeOn;
    filters?: Filter;
    sort?: SortOption[];
};

export type SortOption = {
    key?: string;
    field?: string | string[];
    direction?: string;
    ignoreCase?: boolean;
    alias?: string;
};

export type FilterCondition = {
    field?: string | string[];
    operator: string;
    value?: unknown;
    isEmptyIgnored?: boolean;
    alias?: string;
};

export type FilterGroup = {
    if?: boolean;
    link: '$and' | '$or';
    conditions: Array<FilterCondition | FilterGroup>;
};

export type Filter = FilterCondition | FilterGroup;

export function isInactiveFilter(filter: Filter) {
    if ('if' in filter && filter.if === false) return true;
    if (
        !('field' in filter) ||
        !filter.isEmptyIgnored ||
        typeof filter.operator !== 'string' ||
        filter.operator.includes(':null')
    ) {
        return false;
    }

    const value = filter.value;
    return (
        value === null ||
        value === undefined ||
        value === '' ||
        (Array.isArray(value) && value.length === 0) ||
        (typeof value === 'object' && value !== null && Object.keys(value).length === 0)
    );
}

export type ColumnModeArray = {
    $mode: 'array';
    field: string;
};

export type ColumnModeAll = {
    '*'?: true;
};

export type AliasedColumn = {
    $alias: string;
    $value: ColumnNode;
};

export type ColumnNode = true | ColumnModeArray | ColumnMap | '*' | AliasedColumn;

export type ColumnMap = ColumnModeAll & {
    [key: string]: ColumnNode;
};

export type SelectColumns = '*' | ColumnMap;

export type FormulaSqlCall = {
    formulaId: string;
    field: string;
    scopeAlias?: string;
    artifactHash?: string;
    sqlSchema: string;
    sqlName: string;
    inputAbiVersion: 1 | 2;
    previewVersion?: 1;
    resultType: { formulaType: string; postgresType: string };
};

export type FormulaQueryInputs = {
    parameters?: Record<string, unknown>;
    env: Record<string, string>;
    authUser?: unknown;
    isAuthenticated: boolean;
    timestamp: string;
    randomSeed: string;
};

export type SelectQueryOptions = FormatOption & {
    isolateFormulaErrors?: boolean;
    schema?: string;
    table: string;
    columns?: SelectColumns;
    filters?: Filter;
    sort?: SortOption[];
    limit?: number | string;
    offset?: number | string;
    includes?: IncludeConfig[];
    databaseSchema?: DatabaseSchema | null;
    formulaCalls?: FormulaSqlCall[];
    formulaInputs?: FormulaQueryInputs;
};

type SelectedRowSource = {
    relation: string;
    sourceField: string;
    relationField: string;
};

export type CountQueryOptions = FormatOption & {
    schema?: string;
    table: string;
    filters?: Filter;
    includes?: IncludeConfig[];
    databaseSchema?: DatabaseSchema | null;
    formulaCalls?: FormulaSqlCall[];
    formulaInputs?: FormulaQueryInputs;
};

export type InsertQueryOptions = FormatOption & {
    schema?: string;
    table: string;
    data: Record<string, unknown> | Array<Record<string, unknown>>;
    upsert?: boolean;
    returnData?: boolean;
    primaryColumn?: string;
    databaseSchema?: DatabaseSchema | null;
};

export type UpdateQueryOptions = FormatOption & {
    schema?: string;
    table: string;
    data: Record<string, unknown>;
    filters?: Filter;
    returnData?: boolean;
    databaseSchema?: DatabaseSchema | null;
};

export type DeleteQueryOptions = FormatOption & {
    schema?: string;
    table: string;
    filters?: Filter;
    returnData?: boolean;
    databaseSchema?: DatabaseSchema | null;
};

export type QueryResult = {
    query: string;
    params: unknown[];
};

type IncludeSelection = { mode: 'filter' } | { mode: 'array'; field: string } | { mode: 'object'; columns?: string[] };

type JoinClauseOptions = {
    correlateMany?: boolean;
    skipMany?: boolean;
    requiredAliases?: Set<string>;
    includeMap?: Map<string, IncludeConfig>;
    nested?: boolean;
    startParamIndex?: number;
    databaseSchema?: DatabaseSchema | null;
    formulaClausesByScope?: Map<string, ScopedFormulaClause[]>;
    formulaSlots?: Map<string, FormulaSlot>;
    rowSource?: SelectedRowSource;
};

type ScopedFormulaClause = {
    alias: string;
    expression: string;
};

type JoinClauseResult = {
    clause: string | null;
    params: unknown[];
};

type TableReference = {
    schema?: string;
    table?: string;
};

type WhereClauseSchemaContext = {
    databaseSchema?: DatabaseSchema | null;
    defaultTable?: TableReference;
    includeMap?: Map<string, IncludeConfig>;
    formulaSlots?: Map<string, FormulaSlot>;
};

type FormulaSlot = {
    alias: string;
    field: string;
    resultType: string;
    scopeAlias?: string;
    valueExpression?: string;
};

type ProjectionSources = {
    rows: Map<string, string>;
    aggregates: Map<string, string>;
};

function formulaValue(slot: FormulaSlot) {
    return slot.valueExpression || `${escapeIdentifier(slot.alias)}.${escapeIdentifier('value')}`;
}

function projectionRow(sqlAlias: string, sources?: ProjectionSources) {
    return sources?.rows.get(sqlAlias) || escapeIdentifier(sqlAlias);
}

function projectionRowJson(sqlAlias: string, sources?: ProjectionSources) {
    // A bare table alias can resolve to a same-named physical column instead.
    const row = sources?.rows.get(sqlAlias) || `${escapeIdentifier(sqlAlias)}.*`;
    return `to_jsonb(${row})`;
}

function projectionAggregate(sqlAlias: string, sources?: ProjectionSources) {
    return sources?.aggregates.get(sqlAlias) || `${escapeIdentifier(`${sqlAlias}_sub`)}.${escapeIdentifier(sqlAlias)}`;
}

const FORMULA_ROW_PLACEHOLDER = '__WW_FORMULA_ROW__';

function formulaSlotKey(field: string, scopeAlias?: string) {
    return JSON.stringify([scopeAlias || '', field]);
}

function getFormulaSlot(slots: Map<string, FormulaSlot> | undefined, field: string, scopeAlias?: string) {
    return slots?.get(formulaSlotKey(field, scopeAlias));
}

function getFormulaSlotsForScope(slots: Map<string, FormulaSlot> | undefined, scopeAlias: string) {
    return [...(slots?.values() || [])].filter(slot => slot.scopeAlias === scopeAlias);
}

function escapeTextLiteral(value: string) {
    return `'${value.replaceAll("'", "''")}'`;
}

function buildFormulaProjectionEntry(slot: FormulaSlot) {
    return `${escapeTextLiteral(slot.field)}, ${formulaValue(slot)}`;
}

const TYPE_CASTS: Record<string, string> = {
    bigint: 'bigint',
    bigserial: 'bigint',
    boolean: 'boolean',
    bool: 'boolean',
    date: 'date',
    'double precision': 'double precision',
    integer: 'integer',
    int: 'integer',
    int2: 'smallint',
    int4: 'integer',
    int8: 'bigint',
    json: 'json',
    jsonb: 'jsonb',
    numeric: 'numeric',
    real: 'real',
    serial: 'integer',
    smallint: 'smallint',
    text: 'text',
    time: 'time',
    'time without time zone': 'time without time zone',
    'time with time zone': 'time with time zone',
    timestamp: 'timestamp',
    'timestamp without time zone': 'timestamp without time zone',
    'timestamp with time zone': 'timestamp with time zone',
    timestamptz: 'timestamp with time zone',
    uuid: 'uuid',
    varchar: 'text',
    'character varying': 'text',
};

function normalizeFieldPath(field?: string | string[]): string[] {
    if (field === undefined) return [];
    return Array.isArray(field) ? field : [field];
}

function normalizeIncludes(includes: IncludeConfig[]): IncludeConfig[] {
    const aliasToSqlAlias = new Map<string, string>();

    const normalized = includes.map((include, index) => {
        if (!Array.isArray(include.path) || include.path.length === 0) {
            if (!include.alias) {
                throw new Error('Include must have alias or path');
            }
            const sqlAlias = include.sqlAlias || `_i${index}`;
            aliasToSqlAlias.set(include.alias, sqlAlias);
            return { ...include, sqlAlias };
        }
        const alias = include.alias || include.path.join('.');
        const fromAlias = include.fromAlias ?? (include.path.length > 1 ? include.path.slice(0, -1).join('.') : null);
        const sqlAlias = `_i${index}`;
        aliasToSqlAlias.set(alias, sqlAlias);
        return { ...include, alias, fromAlias, sqlAlias };
    });

    return normalized.map(include => {
        const fromSqlAlias = include.fromAlias ? (aliasToSqlAlias.get(include.fromAlias) ?? null) : null;
        return { ...include, fromSqlAlias };
    });
}

function getTableSchema(databaseSchema: DatabaseSchema | null | undefined, schema = 'public', table?: string) {
    if (!databaseSchema?.tables || !table) return null;

    return (
        databaseSchema.tables[`${schema}.${table}`] ??
        (schema === 'public' ? databaseSchema.tables[table] : null) ??
        null
    );
}

function getColumnType(
    databaseSchema: DatabaseSchema | null | undefined,
    schema = 'public',
    table: string | undefined,
    column: string
) {
    return getTableSchema(databaseSchema, schema, table)?.columns?.[column]?.type;
}

function normalizeColumnType(columnType?: string) {
    return typeof columnType === 'string' ? columnType.trim().toLowerCase().replace(/\s+/g, ' ') : '';
}

export function isTextSortType(columnType?: string): boolean {
    const type = normalizeColumnType(columnType)
        .replace(/\(\d+\)$/, '')
        .trim();
    return ['text', 'varchar', 'character varying', 'char', 'character', 'bpchar', 'citext'].includes(type);
}

function textSortExpression(value: string, ignoreCase: boolean | undefined, columnType?: string): string {
    return ignoreCase === true && isTextSortType(columnType) ? `LOWER(${value})` : value;
}

function isJsonColumnType(columnType?: string) {
    const normalized = normalizeColumnType(columnType);
    return normalized === 'json' || normalized === 'jsonb';
}

function getColumnTypeCast(columnType?: string) {
    const normalized = normalizeColumnType(columnType);
    if (!normalized) return null;

    if (normalized.endsWith('[]')) {
        const baseType = normalized.slice(0, -2);
        const baseCast = TYPE_CASTS[baseType];
        return baseCast ? `${baseCast}[]` : null;
    }

    return TYPE_CASTS[normalized] || null;
}

function getArrayItemTypeCast(columnType?: string) {
    const normalized = normalizeColumnType(columnType);
    if (!normalized.endsWith('[]')) return null;

    const baseType = normalized.slice(0, -2);
    return TYPE_CASTS[baseType] || null;
}

function formatParameterPlaceholder(index: number, columnType?: string) {
    const cast = getColumnTypeCast(columnType);
    return cast ? `$${index}::${cast}` : `$${index}`;
}

function formatArrayItemPlaceholder(index: number, columnType?: string) {
    const cast = getArrayItemTypeCast(columnType);
    return cast ? `$${index}::${cast}` : `$${index}`;
}

function prepareColumnValue(value: unknown, columnType?: string) {
    if (value === null || value === undefined) return value;
    if (isJsonColumnType(columnType) && typeof value === 'object') return JSON.stringify(value);
    return value;
}

function pushTypedParam(params: unknown[], value: unknown, columnType?: string) {
    params.push(prepareColumnValue(value, columnType));
    return formatParameterPlaceholder(params.length, columnType);
}

function resolveConditionColumnType(
    field: string,
    alias: string | undefined,
    schemaContext?: WhereClauseSchemaContext
) {
    const formulaSlot = getFormulaSlot(schemaContext?.formulaSlots, field, alias);
    if (formulaSlot) return formulaSlot.resultType;
    if (!schemaContext?.databaseSchema) return undefined;

    const tableRef = alias ? schemaContext.includeMap?.get(alias) : schemaContext.defaultTable;
    if (!tableRef?.table) return undefined;

    return getColumnType(schemaContext.databaseSchema, tableRef.schema || 'public', tableRef.table, field);
}

function buildFormulaSlots(
    calls: FormulaSqlCall[],
    inputs: FormulaQueryInputs | undefined,
    params: unknown[],
    deferredKeys = new Set<string>(),
    previewKeys = new Set<string>()
) {
    const clauses: string[] = [];
    const deferredClauses = new Map<string, ScopedFormulaClause>();
    const clausesByScope = new Map<string, ScopedFormulaClause[]>();
    const slots = new Map<string, FormulaSlot>();
    if (!calls.length) return { clauses, clausesByScope, slots, deferredClauses };
    if (!inputs) throw new Error('Formula query inputs are required');

    for (let index = 0; index < calls.length; index += 1) {
        const call = calls[index];
        const alias = `_ww_formula_${index}`;
        const firstParamIndex = params.length + 1;
        if (call.inputAbiVersion === 2) params.push(JSON.stringify(inputs.parameters || {}));
        params.push(
            JSON.stringify(inputs.env),
            inputs.authUser === undefined ? null : JSON.stringify(inputs.authUser),
            inputs.isAuthenticated,
            inputs.timestamp,
            inputs.randomSeed
        );
        const parameterOffset = call.inputAbiVersion === 2 ? 1 : 0;
        const key = formulaSlotKey(call.field, call.scopeAlias);
        const isolate = previewKeys.has(key) && call.previewVersion === 1 && call.inputAbiVersion === 2;
        const args = [
            FORMULA_ROW_PLACEHOLDER,
            ...(call.inputAbiVersion === 2 ? [`$${firstParamIndex}::jsonb`] : []),
            `$${firstParamIndex + parameterOffset}::jsonb`,
            `$${firstParamIndex + parameterOffset + 1}::jsonb`,
            `$${firstParamIndex + parameterOffset + 2}::boolean`,
            `$${firstParamIndex + parameterOffset + 3}::timestamp with time zone`,
            `$${firstParamIndex + parameterOffset + 4}::text`,
        ];
        const expression = `${escapeIdentifier(call.sqlSchema)}.${escapeIdentifier(call.sqlName + (isolate ? '_preview' : ''))}(${args.join(', ')})`;
        if (deferredKeys.has(key)) {
            deferredClauses.set(key, { alias, expression });
        } else if (call.scopeAlias) {
            const scopedClauses = clausesByScope.get(call.scopeAlias) || [];
            scopedClauses.push({ alias, expression });
            clausesByScope.set(call.scopeAlias, scopedClauses);
        } else {
            clauses.push(
                renderFormulaClause({ alias, expression: expression.replaceAll(FORMULA_ROW_PLACEHOLDER, 'srcTable.*') })
            );
        }
        slots.set(formulaSlotKey(call.field, call.scopeAlias), {
            alias,
            field: call.field,
            resultType: call.resultType.postgresType,
            ...(call.scopeAlias ? { scopeAlias: call.scopeAlias } : {}),
        });
    }
    return { clauses, clausesByScope, slots, deferredClauses };
}

function renderFormulaClause(clause: ScopedFormulaClause, nullWhen?: string) {
    const expression = nullWhen
        ? `CASE WHEN ${nullWhen} IS NULL THEN NULL ELSE ${clause.expression} END`
        : clause.expression;
    // OFFSET 0 is an intentional PostgreSQL optimization fence: without it the planner can flatten
    // this lateral SELECT and repeat an immutable formula call in projection, filters, and sorting.
    return `CROSS JOIN LATERAL (SELECT ${expression} AS ${escapeIdentifier('value')} OFFSET 0) AS ${escapeIdentifier(clause.alias)}`;
}

function getFormulaCallsUsedByFilter(calls: FormulaSqlCall[], filter?: Filter) {
    if (!filter || !calls.length) return [];
    const keys = new Set<string>();
    const visit = (node: Filter) => {
        if (isInactiveFilter(node)) return;
        if ('conditions' in node && Array.isArray(node.conditions)) {
            for (const condition of node.conditions) visit(condition);
            return;
        }
        if (!('field' in node)) return;
        const path = normalizeFieldPath(node.field);
        if (!path.length) return;
        const field = path[path.length - 1];
        const scopeAlias = path.length > 1 ? path.slice(0, -1).join('.') : node.alias;
        keys.add(formulaSlotKey(field, scopeAlias));
    };
    visit(filter);
    return calls.filter(call => keys.has(formulaSlotKey(call.field, call.scopeAlias)));
}

function resolveSortField(option: SortOption) {
    const path = normalizeFieldPath(option.field);
    return {
        field: path.at(-1) || option.key,
        alias: path.length > 1 ? path.slice(0, -1).join('.') : option.alias,
    };
}

function parsePaginationValue(value: number | string | undefined) {
    if (value === undefined) return undefined;
    const number = typeof value === 'number' ? value : Number.parseInt(value, 10);
    return number >= 0 ? number : undefined;
}

function isFormulaSelected(call: FormulaSqlCall, columns: SelectColumns) {
    const node = call.scopeAlias ? resolveColumnNode(columns, call.scopeAlias.split('.')) : columns;
    if (!node) return false;
    if (call.scopeAlias && (node === '*' || hasAllColumns(node))) return true;
    if (isColumnModeArray(node)) return node.field === call.field;
    if (typeof node !== 'object' || !Object.hasOwn(node, call.field)) return false;
    return extractAliasAndValue((node as ColumnMap)[call.field]).actualValue === true;
}

function planFormulaSelection(
    calls: FormulaSqlCall[],
    columns: SelectColumns,
    filters: Filter | undefined,
    sort: SortOption[],
    includes: IncludeConfig[],
    includeMap: Map<string, IncludeConfig>,
    requiredAliases: Set<string>,
    paginated: boolean
) {
    const usedKeys = new Set<string>();
    const addUses = (filter: Filter | undefined, ordering: SortOption[] | undefined, scope?: IncludeConfig) => {
        const scopedFilter = scope
            ? transformFilterForScopeWithSqlAlias(filter, scope.alias!, scope.sqlAlias!, includeMap)
            : filter;
        for (const call of getFormulaCallsUsedByFilter(calls, scopedFilter)) {
            usedKeys.add(formulaSlotKey(call.field, call.scopeAlias));
        }
        const scopedSort = scope
            ? transformSortForScopeWithSqlAlias(ordering, scope.alias!, scope.sqlAlias!, includeMap)
            : ordering;
        for (const option of scopedSort || []) {
            const { field, alias } = resolveSortField(option);
            if (field) usedKeys.add(formulaSlotKey(field, alias || scope?.alias));
        }
    };
    addUses(filters, sort);
    for (const include of includes) {
        if (requiredAliases.has(include.alias!)) addUses(include.filters, include.sort, include);
    }
    const selectedCalls = calls.filter(
        call =>
            (!call.scopeAlias || requiredAliases.has(call.scopeAlias)) &&
            (usedKeys.has(formulaSlotKey(call.field, call.scopeAlias)) || isFormulaSelected(call, columns))
    );
    const deferredKeys = new Set(
        selectedCalls
            .filter(
                call =>
                    !usedKeys.has(formulaSlotKey(call.field, call.scopeAlias)) &&
                    !hasManyAncestor(call.scopeAlias, includeMap)
            )
            .map(call => formulaSlotKey(call.field, call.scopeAlias))
    );

    // A grouped LEFT relation contributes at most one row and cannot remove a parent.
    // Single joins and INNER relations stay before paging to preserve cardinality.
    const membershipAliases = collectRequiredAliases(filters, sort, includes, undefined);
    const deferredIncludes = new Set(
        includes.filter(
            include =>
                paginated &&
                selectedCalls.some(call =>
                    hasIncludeAncestor(call.scopeAlias, includeMap, ancestor => ancestor === include)
                ) &&
                include.many &&
                include.joinType !== 'inner' &&
                requiredAliases.has(include.alias!) &&
                !membershipAliases.has(include.alias!) &&
                !hasManyAncestor(include.fromAlias, includeMap)
        )
    );
    return { selectedCalls, deferredKeys, deferredIncludes };
}

function buildSelectColumns(
    columns: SelectColumns,
    includeMap: Map<string, IncludeConfig>,
    formulaSlots: Map<string, FormulaSlot>,
    isPretty: boolean,
    sources?: ProjectionSources
) {
    const root = sources?.rows.get('srcTable') || 'srcTable';
    if (!columns || columns === '*') return [`${root}.*`];
    const result: string[] = hasAllColumns(columns) ? [`${root}.*`] : [];
    for (const [key, value] of Object.entries(columns)) {
        if (shouldSkipColumnKey(key)) continue;
        const { alias, actualValue } = extractAliasAndValue(value);
        const slot = getFormulaSlot(formulaSlots, key);
        if (actualValue === true) {
            const expression = slot ? formulaValue(slot) : `${root}.${escapeIdentifier(key)}`;
            result.push(alias || slot ? `${expression} as ${escapeIdentifier(alias || key)}` : expression);
            continue;
        }
        result.push(
            `${buildRelationExpression([key], actualValue, includeMap, isPretty, formulaSlots, sources)} as ${escapeIdentifier(alias || key)}`
        );
    }
    return result.length ? result : [`${root}.*`];
}

function buildSelectQuery({
    schema = 'public',
    table,
    columns = '*',
    filters,
    sort = [],
    limit,
    offset,
    includes = [],
    format = 'min',
    databaseSchema = null,
    formulaCalls = [],
    formulaInputs,
    isolateFormulaErrors = false,
    rowSource,
}: SelectQueryOptions & { rowSource?: SelectedRowSource }): QueryResult {
    const isPretty = format === 'pretty';
    const params: unknown[] = [];
    const normalizedIncludes = normalizeIncludes(includes);
    const includeMap = buildIncludeMap(normalizedIncludes);
    const requiredAliases = collectRequiredAliases(filters, sort, normalizedIncludes, columns);
    const pageLimit = parsePaginationValue(limit);
    const pageOffset = parsePaginationValue(offset);
    const { selectedCalls, deferredKeys, deferredIncludes } = planFormulaSelection(
        formulaCalls,
        columns,
        filters,
        sort,
        normalizedIncludes,
        includeMap,
        requiredAliases,
        pageLimit !== undefined || (pageOffset !== undefined && pageOffset > 0)
    );
    const previewKeys = new Set(
        selectedCalls
            .filter(call => isolateFormulaErrors && !call.scopeAlias && deferredKeys.has(formulaSlotKey(call.field)))
            .map(call => formulaSlotKey(call.field))
    );
    const {
        clauses: formulaClauses,
        clausesByScope: formulaClausesByScope,
        slots: formulaSlots,
        deferredClauses,
    } = buildFormulaSlots(selectedCalls, formulaInputs, params, deferredKeys, previewKeys);
    const deferProjection = deferredClauses.size > 0 || deferredIncludes.size > 0;
    const belongsToDeferredInclude = (alias: string) =>
        hasIncludeAncestor(alias, includeMap, include => deferredIncludes.has(include));
    const earlyIncludes = normalizedIncludes.filter(include => !belongsToDeferredInclude(include.alias!));
    const earlyIncludeMap = buildIncludeMap(earlyIncludes);
    const sources: ProjectionSources = { rows: new Map(), aggregates: new Map() };
    const pageColumns: string[] = [];
    const projectionSlots = new Map(formulaSlots);
    const carry = (expression: string, name: string) => {
        pageColumns.push(`${expression} AS ${escapeIdentifier(name)}`);
        return `"_ww_page".${escapeIdentifier(name)}`;
    };
    const carryRow = (sqlAlias: string, rowSchema: string, rowTable: string, name: string) => {
        // The identity cast keeps alias.* as one typed composite SELECT target,
        // rather than expanding it into columns or resolving a bare alias as a column.
        const row = `(${sqlAlias}.*)::${escapeIdentifier(rowSchema)}.${escapeIdentifier(rowTable)}`;
        return `(${carry(row, name)})`;
    };
    if (deferProjection) {
        sources.rows.set('srcTable', carryRow('srcTable', schema, table, '_ww_source'));
        for (const [index, include] of earlyIncludes.entries()) {
            if (!requiredAliases.has(include.alias!) || hasManyAncestor(include.fromAlias, includeMap)) continue;
            const sqlAlias = include.sqlAlias!;
            if (include.many) {
                // Filter-only groups have no projected aggregate column.
                if (resolveIncludeSelection(columns, include.alias).mode !== 'filter') {
                    sources.aggregates.set(sqlAlias, carry(projectionAggregate(sqlAlias), `_ww_relation_${index}`));
                }
            } else {
                sources.rows.set(
                    sqlAlias,
                    carryRow(escapeIdentifier(sqlAlias), include.schema || 'public', include.table, `_ww_row_${index}`)
                );
            }
        }
        for (const [key, slot] of formulaSlots) {
            if (deferredKeys.has(key) || hasManyAncestor(slot.scopeAlias, includeMap)) continue;
            projectionSlots.set(key, { ...slot, valueExpression: carry(formulaValue(slot), slot.alias) });
        }
    }

    const joins: string[] = [];
    const appendJoin = (target: string[], include: IncludeConfig, options: JoinClauseOptions, base?: string) => {
        const joinOptions = {
            ...options,
            requiredAliases,
            startParamIndex: params.length + 1,
            databaseSchema,
            formulaClausesByScope,
            formulaSlots,
            rowSource,
        };
        const result = base
            ? buildJoinClauseWithBase(include, columns, isPretty, joinOptions, base)
            : buildJoinClause(include, columns, isPretty, joinOptions);
        params.push(...result.params);
        if (result.clause) target.push(result.clause);
    };
    for (const include of earlyIncludes) appendJoin(joins, include, { includeMap: earlyIncludeMap });

    const tail: string[] = [];
    if (filters) {
        const result = buildWhereClauseWithIncludeMap(filters, params.length + 1, includeMap, 'srcTable', {
            databaseSchema,
            defaultTable: { schema, table },
            includeMap,
            formulaSlots,
        });
        if (result.whereClause) tail.push(result.whereClause);
        params.push(...result.params);
    }
    const orderBy: string[] = [];
    const pageOrderBy: string[] = [];
    let usesCaseInsensitiveOrder = false;
    let hasIdentityOrder = false;
    for (const option of sort || []) {
        const { field, alias } = resolveSortField(option);
        if (!field) continue;
        const direction = option.direction ? option.direction.toUpperCase() : 'ASC';
        if (direction !== 'ASC' && direction !== 'DESC') throw new Error(`Invalid sort order: ${direction}`);
        const slot = getFormulaSlot(formulaSlots, field, alias || undefined);
        const relation = alias ? escapeIdentifier(includeMap.get(alias)?.sqlAlias || alias) : 'srcTable';
        const value = slot ? formulaValue(slot) : `${relation}.${escapeIdentifier(field)}`;
        const columnType = resolveConditionColumnType(field, alias || undefined, {
            databaseSchema,
            defaultTable: { schema, table },
            includeMap,
            formulaSlots,
        });
        const expression = textSortExpression(value, option.ignoreCase, columnType);
        if (expression !== value) usesCaseInsensitiveOrder = true;
        if (field === 'id' && !alias && expression === value) hasIdentityOrder = true;
        orderBy.push(`${expression} ${direction}`);
        if (deferProjection) pageOrderBy.push(`${carry(expression, `_ww_sort_${pageOrderBy.length}`)} ${direction}`);
    }
    if (usesCaseInsensitiveOrder && !hasIdentityOrder) {
        orderBy.push('srcTable."id" ASC');
        if (deferProjection) pageOrderBy.push(`${carry('srcTable."id"', `_ww_sort_${pageOrderBy.length}`)} ASC`);
    }
    if (orderBy.length) tail.push(formatClause('ORDER BY', orderBy, isPretty));
    if (pageLimit !== undefined) {
        tail.push(`LIMIT $${params.length + 1}`);
        params.push(pageLimit);
    }
    if (pageOffset !== undefined) {
        tail.push(`OFFSET $${params.length + 1}`);
        params.push(pageOffset);
    }
    const projection = buildSelectColumns(
        columns,
        includeMap,
        deferProjection ? projectionSlots : formulaSlots,
        isPretty,
        deferProjection ? sources : undefined
    );
    const lines = [
        formatClause('SELECT', deferProjection ? pageColumns : projection, isPretty),
        `FROM ${escapeIdentifier(schema)}.${escapeIdentifier(table)} as srcTable`,
        ...(rowSource
            ? [
                  `INNER JOIN ${escapeIdentifier(rowSource.relation)} AS "_ww_selected_source" ON srcTable.${escapeIdentifier(rowSource.sourceField)} = "_ww_selected_source".${escapeIdentifier(rowSource.relationField)}`,
              ]
            : []),
        ...formulaClauses,
        ...joins,
        ...tail,
    ];
    if (!deferProjection) return { query: joinLines(lines, isPretty), params };

    // LIMIT alone defers no OFFSET-discarded projections. Keep the actual page as
    // a boundary, including for unpaginated calls, and bind display values outside it.
    if (!tail.some(line => line.startsWith('OFFSET '))) lines.push('OFFSET 0');
    const outer = [formatClause('SELECT', projection, isPretty), `FROM (${joinLines(lines, isPretty)}) AS "_ww_page"`];
    for (const [key, clause] of deferredClauses) {
        const slot = formulaSlots.get(key)!;
        const include = slot.scopeAlias ? includeMap.get(slot.scopeAlias)! : undefined;
        const row = sources.rows.get(include?.sqlAlias || 'srcTable')!;
        outer.push(
            renderFormulaClause(
                { ...clause, expression: clause.expression.replaceAll(FORMULA_ROW_PLACEHOLDER, row) },
                include ? `${row}.${escapeIdentifier(include.on!.right)}` : undefined
            )
        );
    }
    for (const include of deferredIncludes) {
        const parent = include.fromAlias ? includeMap.get(include.fromAlias) : undefined;
        appendJoin(
            outer,
            include,
            { includeMap, correlateMany: true },
            sources.rows.get(parent?.sqlAlias || 'srcTable')
        );
    }
    if (pageOrderBy.length) outer.push(formatClause('ORDER BY', pageOrderBy, isPretty));
    return { query: joinLines(outer, isPretty), params };
}

export function getSelectQuery(options: SelectQueryOptions): QueryResult {
    return buildSelectQuery(options);
}

export function getSelectQueryForRows(options: SelectQueryOptions, rowSource: SelectedRowSource): QueryResult {
    return buildSelectQuery({ ...options, rowSource });
}

export function getCountQuery({
    schema = 'public',
    table,
    filters,
    includes = [],
    format = 'min',
    databaseSchema = null,
    formulaCalls = [],
    formulaInputs,
}: CountQueryOptions): QueryResult {
    const isPretty = format === 'pretty';
    const lines: string[] = [];
    const params: unknown[] = [];
    const normalizedIncludes = normalizeIncludes(includes);
    const countFormulaCalls = getFormulaCallsUsedByFilter(formulaCalls, filters);
    const {
        clauses: formulaClauses,
        clausesByScope: formulaClausesByScope,
        slots: formulaSlots,
    } = buildFormulaSlots(countFormulaCalls, formulaInputs, params);

    lines.push(formatClause('SELECT', ['COUNT(*)'], isPretty));
    lines.push(`FROM ${escapeIdentifier(schema)}.${escapeIdentifier(table)} as srcTable`);
    lines.push(...formulaClauses);

    const requiredAliases = collectRequiredAliases(filters, undefined, normalizedIncludes, undefined);
    const includeMap = buildIncludeMap(normalizedIncludes);
    let currentParamIndex = params.length + 1;
    for (const include of normalizedIncludes) {
        const { clause: joinClause, params: joinParams } = buildJoinClause(include, undefined, isPretty, {
            skipMany: true,
            requiredAliases,
            includeMap,
            startParamIndex: currentParamIndex,
            databaseSchema,
            formulaClausesByScope,
            formulaSlots,
        });
        if (joinClause) {
            lines.push(joinClause);
            params.push(...joinParams);
            currentParamIndex += joinParams.length;
        }
    }

    if (filters) {
        const { whereClause, params: whereParams } = buildWhereClauseWithIncludeMap(
            filters,
            currentParamIndex,
            includeMap,
            'srcTable',
            {
                databaseSchema,
                defaultTable: { schema, table },
                includeMap,
                formulaSlots,
            }
        );
        if (whereClause) {
            lines.push(whereClause);
            params.push(...whereParams);
        }
    }
    return { query: joinLines(lines, isPretty), params };
}

export function getInsertQuery({
    schema = 'public',
    table,
    data,
    upsert = false,
    returnData = false,
    format = 'min',
    primaryColumn = 'id',
    databaseSchema = null,
}: InsertQueryOptions): QueryResult {
    const isPretty = format === 'pretty';
    const lines: string[] = [];
    let params: unknown[] = [];
    let columns: string[] = [];

    if (!Array.isArray(data)) {
        columns = Object.keys(data);

        if (columns.length === 0) {
            lines.push(`INSERT INTO ${escapeIdentifier(schema)}.${escapeIdentifier(table)} DEFAULT VALUES`);
        } else {
            const placeholders: string[] = [];
            for (const col of columns) {
                const columnType = getColumnType(databaseSchema, schema, table, col);
                placeholders.push(pushTypedParam(params, data[col], columnType));
            }
            const columnsList = columns.map(col => escapeIdentifier(col)).join(', ');
            lines.push(`INSERT INTO ${escapeIdentifier(schema)}.${escapeIdentifier(table)} (${columnsList})`);
            lines.push(formatClause('VALUES', [`(${placeholders.join(', ')})`], isPretty));
        }
    } else {
        if (data.length === 0) throw new Error('Data array cannot be empty');

        columns = Object.keys(data[0]);
        const valueGroups: string[] = [];

        for (const row of data) {
            const rowValues: string[] = [];
            for (const col of columns) {
                const columnType = getColumnType(databaseSchema, schema, table, col);
                const value = row[col];
                rowValues.push(pushTypedParam(params, value, columnType));
            }
            valueGroups.push(`(${rowValues.join(', ')})`);
        }

        const columnsList = columns.map(col => escapeIdentifier(col)).join(', ');
        lines.push(`INSERT INTO ${escapeIdentifier(schema)}.${escapeIdentifier(table)} as srcTable (${columnsList})`);
        lines.push(formatClause('VALUES', valueGroups, isPretty));
    }

    if (upsert) {
        const updateColumns = columns.filter(col => col !== primaryColumn);
        if (updateColumns.length > 0) {
            const setClause = updateColumns
                .map(col => `${escapeIdentifier(col)} = EXCLUDED.${escapeIdentifier(col)}`)
                .join(', ');
            lines.push(`ON CONFLICT (${primaryColumn}) DO UPDATE SET ${setClause}`);
        }
    }

    if (returnData) {
        lines.push('RETURNING *');
    }

    return { query: joinLines(lines, isPretty), params };
}

export function getUpdateQuery({
    schema = 'public',
    table,
    data,
    filters,
    returnData = false,
    format = 'min',
    databaseSchema = null,
}: UpdateQueryOptions): QueryResult {
    const isPretty = format === 'pretty';
    const columns = Object.keys(data);
    const params: unknown[] = [];
    const setEntries: string[] = [];

    for (let index = 0; index < columns.length; index += 1) {
        const col = columns[index];
        const columnType = getColumnType(databaseSchema, schema, table, col);
        const placeholder = pushTypedParam(params, data[col], columnType);
        setEntries.push(`${escapeIdentifier(col)} = ${placeholder}`);
    }

    const lines: string[] = [];
    lines.push(`UPDATE ${escapeIdentifier(schema)}.${escapeIdentifier(table)} as srcTable`);
    lines.push(formatClause('SET', setEntries, isPretty));

    if (filters) {
        const { whereClause, params: whereParams } = buildWhereClause(filters, params.length + 1, 'srcTable', {
            databaseSchema,
            defaultTable: { schema, table },
        });
        if (whereClause) {
            lines.push(whereClause);
            params.push(...whereParams);
        }
    }

    if (returnData) {
        lines.push('RETURNING *');
    }

    return { query: joinLines(lines, isPretty), params };
}

export function getDeleteQuery({
    schema = 'public',
    table,
    filters,
    returnData = false,
    format = 'min',
    databaseSchema = null,
}: DeleteQueryOptions): QueryResult {
    const isPretty = format === 'pretty';
    const lines: string[] = [];
    const params: unknown[] = [];

    lines.push(`DELETE FROM ${escapeIdentifier(schema)}.${escapeIdentifier(table)} as srcTable`);

    if (filters) {
        const { whereClause, params: whereParams } = buildWhereClause(filters, 1, 'srcTable', {
            databaseSchema,
            defaultTable: { schema, table },
        });
        if (whereClause) {
            lines.push(whereClause);
            params.push(...whereParams);
        }
    }

    if (returnData) {
        lines.push('RETURNING *');
    }

    return { query: joinLines(lines, isPretty), params };
}

export function buildWhereClause(
    filter: Filter,
    startParamIndex = 1,
    defaultAlias = 'srcTable',
    schemaContext?: WhereClauseSchemaContext
) {
    return buildWhereClauseWithIncludeMap(filter, startParamIndex, undefined, defaultAlias, schemaContext);
}

export function buildWhereClauseWithIncludeMap(
    filter: Filter,
    startParamIndex = 1,
    includeMap?: Map<string, IncludeConfig>,
    defaultAlias = 'srcTable',
    schemaContext?: WhereClauseSchemaContext
) {
    if (!filter) return { whereClause: '', params: [] as unknown[] };

    const params: unknown[] = [];
    let paramIndex = startParamIndex;

    function pushConditionParam(value: unknown, columnType?: string) {
        params.push(prepareColumnValue(value, columnType));
        return formatParameterPlaceholder(paramIndex++, columnType);
    }

    function resolveSqlAlias(alias: string | undefined): string {
        if (!alias) return defaultAlias;
        if (!includeMap) return escapeIdentifier(alias);
        const inc = includeMap.get(alias);
        return inc?.sqlAlias ? escapeIdentifier(inc.sqlAlias) : escapeIdentifier(alias);
    }

    function processCondition(condition: FilterCondition & { sqlAlias?: string }) {
        const { operator, value, sqlAlias } = condition;
        let { alias } = condition;

        const fieldPath = normalizeFieldPath(condition.field);
        if (fieldPath.length === 0 || !operator) {
            throw new Error('Filter condition must have field and operator');
        }

        let field: string = fieldPath[fieldPath.length - 1];
        if (fieldPath.length > 1) {
            alias = fieldPath.slice(0, -1).join('.');
        }

        const formulaSlot = getFormulaSlot(schemaContext?.formulaSlots, field, alias);
        const table = sqlAlias || resolveSqlAlias(alias);
        const columnType = resolveConditionColumnType(field, alias, {
            ...schemaContext,
            includeMap: schemaContext?.includeMap || includeMap,
        });
        field = formulaSlot
            ? `${escapeIdentifier(formulaSlot.alias)}.${escapeIdentifier('value')}`
            : `${table}.${escapeIdentifier(field)}`;
        if (operator.includes(':null')) {
            const baseOperator = operator.split(':')[0];
            switch (baseOperator) {
                case '$eq':
                    return `(${field} IS NULL OR ${field}::text = '' OR ${field}::text = '{}' OR ${field}::text = '[]')`;
                case '$ne':
                    return `(${field} IS NOT NULL AND ${field}::text != '' AND ${field}::text != '{}' AND ${field}::text != '[]')`;
                default:
                    throw new Error(`Unsupported null operator: ${operator}`);
            }
        }

        switch (operator) {
            case '$eq':
                return `${field} = ${pushConditionParam(value, columnType)}`;
            case '$ne':
                return `${field} != ${pushConditionParam(value, columnType)}`;
            case '$gt':
                return `${field} > ${pushConditionParam(value, columnType)}`;
            case '$gte':
                return `${field} >= ${pushConditionParam(value, columnType)}`;
            case '$lt':
                return `${field} < ${pushConditionParam(value, columnType)}`;
            case '$lte':
                return `${field} <= ${pushConditionParam(value, columnType)}`;
            case '$like':
                params.push(value);
                return `${field} LIKE $${paramIndex++}`;
            case '$iLike':
                params.push(value);
                return `${field} ILIKE $${paramIndex++}`;
            case '$iLike:contains':
                params.push(`%${value}%`);
                return `${field} ILIKE $${paramIndex++}`;
            case '$iLike:startsWith':
                params.push(`${value}%`);
                return `${field} ILIKE $${paramIndex++}`;
            case '$iLike:endsWith':
                params.push(`%${value}`);
                return `${field} ILIKE $${paramIndex++}`;
            case '$notILike:contains':
                params.push(`%${value}%`);
                return `${field} NOT ILIKE $${paramIndex++}`;
            case '$in':
                if (Array.isArray(value)) {
                    const placeholders = value
                        .map(item => {
                            params.push(prepareColumnValue(item, columnType));
                            return formatParameterPlaceholder(paramIndex++, columnType);
                        })
                        .join(', ');
                    return `${field} IN (${placeholders})`;
                }
                return `${field} = ${pushConditionParam(value, columnType)}`;
            case '$notIn':
                if (Array.isArray(value)) {
                    const placeholders = value
                        .map(item => {
                            params.push(prepareColumnValue(item, columnType));
                            return formatParameterPlaceholder(paramIndex++, columnType);
                        })
                        .join(', ');
                    return `${field} NOT IN (${placeholders})`;
                }
                return `${field} != ${pushConditionParam(value, columnType)}`;
            case '$overlap':
                if (Array.isArray(value)) {
                    const placeholders = value
                        .map(item => {
                            params.push(item);
                            return formatArrayItemPlaceholder(paramIndex++, columnType);
                        })
                        .join(', ');
                    return `${field} && ARRAY[${placeholders}]`;
                }
                throw new Error('Overlap operator requires an array value');
            case '$notOverlap':
                if (Array.isArray(value)) {
                    const placeholders = value
                        .map(item => {
                            params.push(item);
                            return formatArrayItemPlaceholder(paramIndex++, columnType);
                        })
                        .join(', ');
                    return `NOT (${field} && ARRAY[${placeholders}])`;
                }
                throw new Error('Not overlap operator requires an array value');
            case '$contains':
                if (isJsonColumnType(columnType)) {
                    return `${field} @> ${pushConditionParam(value, columnType)}`;
                }
                if (Array.isArray(value)) {
                    const placeholders = value
                        .map(item => {
                            params.push(item);
                            return formatArrayItemPlaceholder(paramIndex++, columnType);
                        })
                        .join(', ');
                    return `${field} @> ARRAY[${placeholders}]`;
                }
                throw new Error('Contains operator requires an array value');
            case '$has':
                params.push(value);
                return `${field} ? $${paramIndex++}`;
            case '$hasNot':
                params.push(value);
                return `NOT (${field} ? $${paramIndex++})`;
            case '$match':
                params.push(value);
                return `${field} ~ $${paramIndex++}`;
            case '$notMatch':
                params.push(value);
                return `NOT (${field} ~ $${paramIndex++})`;
            default:
                throw new Error(`Unsupported filter operator: ${operator}`);
        }
    }

    function processNestedFilter(filterValue: Filter): string | null {
        if (isInactiveFilter(filterValue)) return null;

        if ('field' in filterValue && 'operator' in filterValue) {
            return processCondition(filterValue as FilterCondition);
        }

        if ('link' in filterValue && Array.isArray((filterValue as FilterGroup).conditions)) {
            const group = filterValue as FilterGroup;
            if (group.conditions.length === 0) {
                return null;
            }

            const processedConditions = group.conditions
                .map(condition => processNestedFilter(condition))
                .filter(condition => condition !== null);

            if (processedConditions.length === 0) {
                return null;
            }

            if (group.link === '$or') {
                return `(${processedConditions.join(' OR ')})`;
            }
            return `(${processedConditions.join(' AND ')})`;
        }

        throw new Error('Invalid filter structure');
    }

    const whereClause = processNestedFilter(filter);
    return { whereClause: whereClause ? `WHERE ${whereClause}` : '', params };
}

function shouldSkipColumnKey(key: string) {
    return key === '*' || key.startsWith('$');
}

function isColumnModeArray(node: ColumnNode): node is ColumnModeArray {
    return typeof node === 'object' && node !== null && (node as ColumnModeArray).$mode === 'array';
}

function hasAllColumns(node: ColumnNode | SelectColumns | undefined): boolean {
    return (
        typeof node === 'object' && node !== null && Object.hasOwn(node, '*') && (node as ColumnModeAll)['*'] === true
    );
}

function isAliasedColumn(node: ColumnNode): node is AliasedColumn {
    return typeof node === 'object' && node !== null && '$alias' in node && '$value' in node;
}

function extractAliasAndValue(node: ColumnNode): { alias: string | null; actualValue: ColumnNode } {
    if (isAliasedColumn(node)) {
        return { alias: node.$alias, actualValue: node.$value };
    }
    return { alias: null, actualValue: node };
}

function resolveColumnNode(columns: SelectColumns | undefined, path: string[]): ColumnNode | undefined {
    if (!columns || columns === '*') {
        return undefined;
    }

    let current: ColumnNode = columns;

    for (const segment of path) {
        if (isAliasedColumn(current)) {
            current = current.$value;
        }

        if (current === '*' || current === true || isColumnModeArray(current)) {
            return undefined;
        }

        const map = current as ColumnMap;
        if (!(segment in map)) {
            return undefined;
        }
        current = map[segment];
    }

    if (isAliasedColumn(current)) {
        current = current.$value;
    }

    return current;
}

function resolveIncludeSelection(columns: SelectColumns | undefined, alias: string | undefined): IncludeSelection {
    if (!alias) {
        return { mode: 'filter' };
    }

    const path = alias.split('.').filter(Boolean);
    if (path.length === 0) {
        return { mode: 'filter' };
    }

    const node = resolveColumnNode(columns, path);
    if (!node) {
        return { mode: 'filter' };
    }

    if (node === '*') {
        return { mode: 'object' };
    }

    if (node === true) {
        return { mode: 'filter' };
    }

    if (isColumnModeArray(node)) {
        return { mode: 'array', field: node.field };
    }

    if (hasAllColumns(node)) {
        return { mode: 'object' };
    }

    const entries = Object.entries(node).filter(([key]) => !shouldSkipColumnKey(key));

    if (entries.length === 0) {
        return { mode: 'filter' };
    }

    const columnsList = entries
        .filter(([, value]) => {
            const { actualValue } = extractAliasAndValue(value as ColumnNode);
            return actualValue === true;
        })
        .map(([key]) => key);

    return { mode: 'object', columns: columnsList };
}

function buildIncludeMap(includes: IncludeConfig[]) {
    const map = new Map<string, IncludeConfig>();
    for (const include of includes) {
        if (include.alias) {
            map.set(include.alias, include);
        }
    }
    return map;
}

function collectRequiredAliases(
    filters: Filter | undefined,
    sort: SortOption[] | undefined,
    includes: IncludeConfig[],
    columns: SelectColumns | undefined
) {
    const required = new Set<string>();

    function collectFilterAliases(filterValue: Filter | undefined, scope?: string) {
        if (!filterValue) return;
        if (isInactiveFilter(filterValue)) return;
        if ('conditions' in filterValue && Array.isArray(filterValue.conditions)) {
            for (const condition of filterValue.conditions) {
                collectFilterAliases(condition, scope);
            }
            return;
        }
        if ('field' in filterValue) {
            const fieldPath = normalizeFieldPath(filterValue.field);
            if (fieldPath.length > 1) {
                required.add([...(scope ? [scope] : []), ...fieldPath.slice(0, -1)].join('.'));
            } else if ('alias' in filterValue && filterValue.alias) {
                required.add(filterValue.alias);
            }
        } else if ('alias' in filterValue && filterValue.alias) {
            required.add(filterValue.alias);
        }
    }

    function collectColumnAliases(node: SelectColumns | ColumnNode | undefined, path: string[] = []) {
        if (!node || node === '*') return;
        if (node === true || isColumnModeArray(node)) return;

        if (isAliasedColumn(node)) {
            collectColumnAliases(node.$value, path);
            return;
        }

        const entries = Object.entries(node as ColumnMap);
        for (const [key, value] of entries) {
            if (shouldSkipColumnKey(key)) continue;
            const { actualValue } = extractAliasAndValue(value);
            if (actualValue === true) continue;

            const nextPath = [...path, key];
            required.add(nextPath.join('.'));

            if (
                actualValue &&
                typeof actualValue === 'object' &&
                !Array.isArray(actualValue) &&
                !isColumnModeArray(actualValue)
            ) {
                collectColumnAliases(actualValue, nextPath);
            }
        }
    }

    collectFilterAliases(filters);
    collectColumnAliases(columns);

    function collectSortAliases(ordering: SortOption[] | undefined, scope?: string) {
        for (const item of ordering || []) {
            const fieldPath = normalizeFieldPath(item.field);
            if (fieldPath.length > 1) {
                required.add([...(scope ? [scope] : []), ...fieldPath.slice(0, -1)].join('.'));
            } else if (item.alias) {
                required.add(item.alias);
            }
        }
    }
    collectSortAliases(sort);

    let changed = true;
    while (changed) {
        const previousSize = required.size;
        for (const include of includes) {
            if (!include.alias || !required.has(include.alias)) continue;
            if (include.fromAlias) required.add(include.fromAlias);
            // An included relation can need further joins solely for its own
            // filter/order. Those dependencies do not have to be projected.
            collectFilterAliases(include.filters, include.alias);
            collectSortAliases(include.sort, include.alias);
        }
        changed = required.size !== previousSize;
    }

    return required;
}

function buildRelationExpression(
    path: string[],
    node: ColumnNode,
    includeMap: Map<string, IncludeConfig>,
    isPretty: boolean,
    formulaSlots?: Map<string, FormulaSlot>,
    sources?: ProjectionSources
) {
    const aliasPath = path.join('.');
    const include = includeMap.get(aliasPath);

    if (!include?.on) {
        throw new Error(`Missing include metadata for path: ${aliasPath}`);
    }

    const sqlAlias = include.sqlAlias || aliasPath;
    const escapedSqlAlias = projectionRow(sqlAlias, sources);

    if (include.many) {
        const defaultValue = isColumnModeArray(node) ? "'{}'" : "'[]'::jsonb";
        return `COALESCE(${projectionAggregate(sqlAlias, sources)}, ${defaultValue})`;
    }

    if (isColumnModeArray(node)) {
        return `${escapedSqlAlias}.${escapeIdentifier(node.field)}`;
    }

    const rowExpression = buildObjectExpressionWithSqlAlias(
        node,
        sqlAlias,
        path,
        includeMap,
        isPretty,
        formulaSlots,
        sources
    );
    const keyRef = `${escapedSqlAlias}.${escapeIdentifier(include.on.right)}`;
    return `CASE WHEN ${keyRef} IS NULL THEN NULL ELSE ${rowExpression} END`;
}

function buildObjectExpressionWithSqlAlias(
    node: ColumnNode,
    sqlAlias: string,
    path: string[],
    includeMap: Map<string, IncludeConfig>,
    isPretty: boolean,
    formulaSlots?: Map<string, FormulaSlot>,
    sources?: ProjectionSources
) {
    const escapedSqlAlias = projectionRow(sqlAlias, sources);

    if (node === '*' || node === true) {
        const rowExpression = projectionRowJson(sqlAlias, sources);
        const scopeAlias = path.join('.');
        const formulaEntries = getFormulaSlotsForScope(formulaSlots, scopeAlias).map(buildFormulaProjectionEntry);
        if (!formulaEntries.length) return rowExpression;
        return `${rowExpression} || ${formatJsonbBuildObject(formulaEntries, isPretty)}`;
    }

    if (isColumnModeArray(node)) {
        return `${escapedSqlAlias}.${escapeIdentifier(node.field)}`;
    }

    const includeAllColumns = hasAllColumns(node);
    const entries: string[] = [];
    for (const [key, value] of Object.entries(node)) {
        if (shouldSkipColumnKey(key)) continue;
        const { alias, actualValue } = extractAliasAndValue(value as ColumnNode);
        const outputKey = alias || key;

        if (actualValue === true) {
            const formulaSlot = getFormulaSlot(formulaSlots, key, path.join('.'));
            const valueExpression = formulaSlot
                ? formulaValue(formulaSlot)
                : `${escapedSqlAlias}.${escapeIdentifier(key)}`;
            entries.push(`${escapeTextLiteral(outputKey)}, ${valueExpression}`);
            continue;
        }

        const childPath = [...path, key];
        const childAliasPath = childPath.join('.');
        const childInclude = includeMap.get(childAliasPath);
        const childSqlAlias = childInclude?.sqlAlias || childAliasPath;

        if (childInclude?.many) {
            const defaultValue = isColumnModeArray(actualValue) ? "'{}'" : "'[]'::jsonb";
            const childExpression = `COALESCE(${projectionAggregate(childSqlAlias, sources)}, ${defaultValue})`;
            entries.push(`${escapeTextLiteral(outputKey)}, ${childExpression}`);
        } else if (isColumnModeArray(actualValue)) {
            entries.push(
                `${escapeTextLiteral(outputKey)}, ${projectionRow(childSqlAlias, sources)}.${escapeIdentifier(actualValue.field)}`
            );
        } else if (childInclude?.on) {
            const childEscapedSqlAlias = projectionRow(childSqlAlias, sources);
            const rowExpression = buildObjectExpressionWithSqlAlias(
                actualValue,
                childSqlAlias,
                childPath,
                includeMap,
                isPretty,
                formulaSlots,
                sources
            );
            const keyRef = `${childEscapedSqlAlias}.${escapeIdentifier(childInclude.on.right)}`;
            const childExpression = `CASE WHEN ${keyRef} IS NULL THEN NULL ELSE ${rowExpression} END`;
            entries.push(`${escapeTextLiteral(outputKey)}, ${childExpression}`);
        }
    }

    if (includeAllColumns) {
        const scopeAlias = path.join('.');
        for (const slot of getFormulaSlotsForScope(formulaSlots, scopeAlias)) {
            if (Object.hasOwn(node, slot.field)) continue;
            entries.push(buildFormulaProjectionEntry(slot));
        }
    }

    if (entries.length === 0) {
        return projectionRowJson(sqlAlias, sources);
    }

    if (includeAllColumns) {
        return `${projectionRowJson(sqlAlias, sources)} || ${formatJsonbBuildObject(entries, isPretty)}`;
    }

    return formatJsonbBuildObject(entries, isPretty);
}

function resolveJoinSqlAlias(alias: string, includeMap?: Map<string, IncludeConfig>): string {
    if (!includeMap) return 'srcTable';
    const parentInclude = includeMap.get(alias);
    if (!parentInclude) return 'srcTable';
    const sqlAlias = parentInclude.sqlAlias || alias;
    if (parentInclude.many) {
        return escapeIdentifier(`${sqlAlias}_sub`);
    }
    return escapeIdentifier(sqlAlias);
}

function hasIncludeAncestor(
    alias: string | null | undefined,
    includeMap: Map<string, IncludeConfig> | undefined,
    matches: (include: IncludeConfig) => boolean
) {
    if (!alias || !includeMap) return false;
    let current = includeMap.get(alias);
    while (current) {
        if (matches(current)) return true;
        if (!current.fromAlias) return false;
        current = includeMap.get(current.fromAlias);
    }
    return false;
}

function hasManyAncestor(alias: string | null | undefined, includeMap?: Map<string, IncludeConfig>) {
    return hasIncludeAncestor(alias, includeMap, include => !!include.many);
}

function transformFilterForScopeWithSqlAlias(
    filter: Filter | undefined,
    scopeAlias: string,
    scopeSqlAlias: string,
    includeMap?: Map<string, IncludeConfig>
): Filter | undefined {
    if (!filter) return undefined;

    const transformed = JSON.parse(JSON.stringify(filter)) as Filter;

    function resolveNestedSqlAlias(nestedAlias: string): string {
        if (!includeMap) return escapeIdentifier(nestedAlias);
        const inc = includeMap.get(nestedAlias);
        return inc?.sqlAlias ? escapeIdentifier(inc.sqlAlias) : escapeIdentifier(nestedAlias);
    }

    function transformCondition(condition: FilterCondition) {
        const fieldPath = normalizeFieldPath(condition.field);
        if (fieldPath.length > 1) {
            const relationPath = fieldPath.slice(0, -1);
            const field = fieldPath[fieldPath.length - 1];
            const nestedAlias = scopeAlias + '.' + relationPath.join('.');
            (condition as FilterCondition & { sqlAlias?: string }).sqlAlias = resolveNestedSqlAlias(nestedAlias);
            condition.alias = nestedAlias;
            condition.field = [field];
        } else if (!condition.alias) {
            (condition as FilterCondition & { sqlAlias?: string }).sqlAlias = `${scopeSqlAlias}_row`;
            condition.alias = scopeAlias;
        }
    }

    function transformGroup(group: FilterGroup) {
        for (const cond of group.conditions) {
            if ('link' in cond && Array.isArray((cond as FilterGroup).conditions)) {
                transformGroup(cond as FilterGroup);
            } else {
                transformCondition(cond as FilterCondition);
            }
        }
    }

    if ('link' in transformed && Array.isArray((transformed as FilterGroup).conditions)) {
        transformGroup(transformed as FilterGroup);
    } else if ((transformed as FilterCondition).field) {
        transformCondition(transformed as FilterCondition);
    }

    return transformed;
}

function transformSortForScopeWithSqlAlias(
    sort: SortOption[] | undefined,
    scopeAlias: string,
    scopeSqlAlias: string,
    includeMap?: Map<string, IncludeConfig>
): (SortOption & { sqlAlias?: string })[] | undefined {
    if (!sort || sort.length === 0) return sort;

    function resolveNestedSqlAlias(nestedAlias: string): string {
        if (!includeMap) return escapeIdentifier(nestedAlias);
        const inc = includeMap.get(nestedAlias);
        return inc?.sqlAlias ? escapeIdentifier(inc.sqlAlias) : escapeIdentifier(nestedAlias);
    }

    return sort.map(option => {
        const fieldPath = normalizeFieldPath(option.field);
        if (fieldPath.length > 1) {
            const relationPath = fieldPath.slice(0, -1);
            const field = fieldPath[fieldPath.length - 1];
            const nestedAlias = scopeAlias + '.' + relationPath.join('.');
            return {
                ...option,
                alias: nestedAlias,
                sqlAlias: resolveNestedSqlAlias(nestedAlias),
                field: [field],
            };
        }
        return { ...option, sqlAlias: `${scopeSqlAlias}_row` };
    });
}

function buildAggregateOrderByExpression(
    sort: (SortOption & { sqlAlias?: string })[] | undefined,
    defaultSqlAlias: string,
    includeMap?: Map<string, IncludeConfig>,
    formulaSlots?: Map<string, FormulaSlot>,
    scopeAlias?: string,
    databaseSchema?: DatabaseSchema | null
): string | null {
    if (!sort || sort.length === 0) return null;

    function resolveSqlAlias(alias: string | undefined): string {
        if (!alias) return defaultSqlAlias;
        if (!includeMap) return escapeIdentifier(alias);
        const inc = includeMap.get(alias);
        return inc?.sqlAlias ? escapeIdentifier(inc.sqlAlias) : escapeIdentifier(alias);
    }

    const clauses: string[] = [];
    for (const option of sort) {
        const { field: key, alias } = resolveSortField(option);
        const { sqlAlias } = option;
        if (!key) continue;
        const order = option.direction ? option.direction.toUpperCase() : 'ASC';
        if (order !== 'ASC' && order !== 'DESC') continue;
        const formulaSlot = getFormulaSlot(formulaSlots, key, alias || scopeAlias);
        const value = formulaSlot
            ? `${escapeIdentifier(formulaSlot.alias)}.${escapeIdentifier('value')}`
            : `${sqlAlias || resolveSqlAlias(alias)}.${escapeIdentifier(key)}`;
        const columnType = resolveConditionColumnType(key, alias || scopeAlias, {
            databaseSchema,
            includeMap,
            formulaSlots,
        });
        const expression = textSortExpression(value, option.ignoreCase, columnType);
        clauses.push(`${expression} ${order}`);
    }

    if (clauses.length === 0) return null;
    return clauses.join(', ');
}

function getScopedFormulaClauses(
    options: JoinClauseOptions,
    scopeAlias: string,
    rowSqlAlias: string,
    nullWhen?: string
) {
    return (options.formulaClausesByScope?.get(scopeAlias) || []).map(clause =>
        renderFormulaClause(
            { ...clause, expression: clause.expression.replaceAll(FORMULA_ROW_PLACEHOLDER, `${rowSqlAlias}.*`) },
            nullWhen
        )
    );
}

function buildJoinClauseWithBase(
    include: IncludeConfig,
    columns: SelectColumns | undefined,
    isPretty: boolean,
    options: JoinClauseOptions,
    baseSqlAlias: string
): JoinClauseResult {
    const { schema: includeSchema = 'public', table: includeTable, on } = include;
    const alias = include.alias || `t${(include.index ?? 0) + 1}`;
    const sqlAlias = include.sqlAlias || alias;
    const escapedSqlAlias = escapeIdentifier(sqlAlias);
    const selection = resolveIncludeSelection(columns, alias);
    const isFilterOnly = selection.mode === 'filter';
    const resultParams: unknown[] = [];

    if (!on?.left || !on?.right) return { clause: null, params: [] };
    if (options.skipMany && include.many) return { clause: null, params: [] };
    if (options.requiredAliases && include.alias && !options.requiredAliases.has(include.alias))
        return { clause: null, params: [] };

    const joinType = include.joinType === 'inner' ? 'INNER' : 'LEFT';

    if (include.many) {
        const subSqlAlias = `${sqlAlias}_sub`;
        const escapedSubSqlAlias = escapeIdentifier(subSqlAlias);
        const groupByColumn = escapeIdentifier(on.right);
        const rowSqlAlias = `${sqlAlias}_row`;
        const escapedRowSqlAlias = escapeIdentifier(rowSqlAlias);
        const formulaClauses = getScopedFormulaClauses(options, alias, escapedRowSqlAlias);

        let selectExpression = `${escapedRowSqlAlias}.${groupByColumn}`;

        const transformedSort = transformSortForScopeWithSqlAlias(include.sort, alias, sqlAlias, options.includeMap);
        const orderByExpression = buildAggregateOrderByExpression(
            transformedSort,
            escapedRowSqlAlias,
            options.includeMap,
            options.formulaSlots,
            alias,
            options.databaseSchema
        );
        const orderBySuffix = orderByExpression ? ` ORDER BY ${orderByExpression}` : '';

        if (!isFilterOnly) {
            let aggColumn;
            if (selection.mode === 'array') {
                const field = escapeIdentifier(selection.field);
                const formulaSlot = getFormulaSlot(options.formulaSlots, selection.field, alias);
                const valueExpression = formulaSlot
                    ? `${escapeIdentifier(formulaSlot.alias)}.${escapeIdentifier('value')}`
                    : `${escapedRowSqlAlias}.${field}`;
                aggColumn = `array_agg(${valueExpression}${orderBySuffix})`;
            } else {
                const includePath = alias.split('.').filter(Boolean);
                const node = resolveColumnNode(columns, includePath) ?? '*';
                const rowExpression = buildObjectExpressionWithSqlAlias(
                    node,
                    rowSqlAlias,
                    includePath,
                    options.includeMap || new Map(),
                    isPretty,
                    options.formulaSlots
                );
                aggColumn = `jsonb_agg(${rowExpression}${orderBySuffix})`;
            }
            selectExpression = `${selectExpression}, ${aggColumn} as ${escapedSqlAlias}`;
        }

        const leftTableMany = baseSqlAlias;
        const leftRefMany = `${leftTableMany}.${escapeIdentifier(on.left)}`;
        const baseTable = `${escapeIdentifier(includeSchema)}.${escapeIdentifier(includeTable)}`;
        const groupedColumn = `${escapedRowSqlAlias}.${groupByColumn}`;
        const selectedRowsJoin =
            options.rowSource && baseSqlAlias === 'srcTable'
                ? `INNER JOIN (SELECT DISTINCT ${escapeIdentifier(on.left)} FROM ${escapeIdentifier(options.rowSource.relation)}) AS "_ww_selected_relation_rows" ON ${groupedColumn} = "_ww_selected_relation_rows".${escapeIdentifier(on.left)}`
                : null;

        const nestedIncludes = options.includeMap
            ? Array.from(options.includeMap.values()).filter(child => child.fromAlias === alias)
            : [];

        let currentParamIndex = options.startParamIndex ?? 1;

        const nestedJoinClauses: string[] = [];
        for (const child of nestedIncludes) {
            const result = buildJoinClauseWithBase(
                child,
                columns,
                isPretty,
                { ...options, nested: true, startParamIndex: currentParamIndex },
                escapedRowSqlAlias
            );
            if (result.clause) nestedJoinClauses.push(result.clause);
            resultParams.push(...result.params);
            currentParamIndex += result.params.length;
        }

        let whereClause = '';
        if (include.filters) {
            const transformedFilters = transformFilterForScopeWithSqlAlias(
                include.filters,
                alias,
                sqlAlias,
                options.includeMap
            );
            const whereResult = buildWhereClauseWithIncludeMap(
                transformedFilters!,
                currentParamIndex,
                options.includeMap,
                escapedRowSqlAlias,
                {
                    databaseSchema: options.databaseSchema,
                    defaultTable: { schema: includeSchema, table: includeTable },
                    includeMap: options.includeMap,
                    formulaSlots: options.formulaSlots,
                }
            );
            whereClause = whereResult.whereClause;
            resultParams.push(...whereResult.params);
        }

        if (options.correlateMany) {
            const correlation = `${groupedColumn} = ${leftRefMany}`;
            whereClause = whereClause ? `${whereClause} AND ${correlation}` : `WHERE ${correlation}`;
        }

        const subqueryLines = [
            `SELECT ${selectExpression}`,
            `FROM ${baseTable} as ${escapedRowSqlAlias}`,
            ...(selectedRowsJoin ? [selectedRowsJoin] : []),
            ...formulaClauses,
            ...nestedJoinClauses,
        ];
        if (whereClause) {
            subqueryLines.push(whereClause);
        }
        subqueryLines.push(`GROUP BY ${groupedColumn}`);

        const subquery = isPretty
            ? `(\n${indentLines(subqueryLines, INDENT_SIZE)}\n)`
            : `(${joinLines(subqueryLines, false)})`;
        const clause = `${joinType} JOIN ${options.correlateMany ? 'LATERAL ' : ''}${subquery} as ${escapedSubSqlAlias} ON ${leftRefMany} = ${escapedSubSqlAlias}.${groupByColumn}`;
        return { clause, params: resultParams };
    }

    const leftTable = baseSqlAlias;
    const leftRef = `${leftTable}.${escapeIdentifier(on.left)}`;
    const baseTable = `${escapeIdentifier(includeSchema)}.${escapeIdentifier(includeTable)}`;

    const joinClause = `${joinType} JOIN ${baseTable} as ${escapedSqlAlias} ON ${leftRef} = ${escapedSqlAlias}.${escapeIdentifier(
        on.right
    )}`;
    const formulaClauses = getScopedFormulaClauses(
        options,
        alias,
        escapedSqlAlias,
        `${escapedSqlAlias}.${escapeIdentifier(on.right)}`
    );
    const separator = isPretty ? '\n' : ' ';
    const joinWithFormulaClauses = formulaClauses.length
        ? `${joinClause}${separator}${formulaClauses.join(separator)}`
        : joinClause;

    if (!options.nested || !options.includeMap) {
        return { clause: joinWithFormulaClauses, params: [] };
    }

    const nestedIncludes = Array.from(options.includeMap.values()).filter(child => child.fromAlias === alias);
    if (!nestedIncludes.length) {
        return { clause: joinWithFormulaClauses, params: [] };
    }

    let currentParamIndex = options.startParamIndex ?? 1;
    const nestedResults = nestedIncludes.map(child => {
        const result = buildJoinClauseWithBase(
            child,
            columns,
            isPretty,
            { ...options, nested: true, startParamIndex: currentParamIndex },
            resolveJoinSqlAlias(alias, options.includeMap)
        );
        currentParamIndex += result.params.length;
        return result;
    });

    const nestedJoinClauses = nestedResults.filter(r => r.clause !== null).map(r => r.clause as string);
    for (const r of nestedResults) {
        resultParams.push(...r.params);
    }

    if (!nestedJoinClauses.length) {
        return { clause: joinWithFormulaClauses, params: resultParams };
    }

    return {
        clause: `${joinWithFormulaClauses}${separator}${nestedJoinClauses.join(separator)}`,
        params: resultParams,
    };
}

function buildJoinClause(
    include: IncludeConfig,
    columns: SelectColumns | undefined,
    isPretty: boolean,
    options: JoinClauseOptions = {}
): JoinClauseResult {
    if (!include.on?.left || !include.on?.right) return { clause: null, params: [] };
    if (options.skipMany && include.many) return { clause: null, params: [] };
    if (options.requiredAliases && include.alias && !options.requiredAliases.has(include.alias))
        return { clause: null, params: [] };

    if (include.fromAlias && options.includeMap && !options.nested) {
        if (hasManyAncestor(include.fromAlias, options.includeMap)) {
            return { clause: null, params: [] };
        }
    }

    const baseSqlAlias = include.fromSqlAlias
        ? resolveJoinSqlAlias(include.fromAlias!, options.includeMap)
        : 'srcTable';

    return buildJoinClauseWithBase(include, columns, isPretty, options, baseSqlAlias);
}
function formatJsonbBuildObject(entries: string[], isPretty: boolean) {
    if (!isPretty) {
        return `jsonb_build_object(${entries.join(', ')})`;
    }
    return `jsonb_build_object(\n${formatList(entries, true)}\n)`;
}

function formatClause(keyword: string, items: string[], isPretty: boolean) {
    if (items.length === 0) return '';
    if (!isPretty || items.length === 1) {
        return `${keyword} ${items.join(', ')}`;
    }
    return `${keyword}\n${formatList(items, true)}`;
}

function formatList(items: string[], isPretty: boolean, indent = '    ') {
    if (!isPretty) return items.join(', ');
    return items.map(item => formatIndentedLines(item, indent)).join(',\n');
}

function formatIndentedLines(value: string, indent: string) {
    return value
        .split('\n')
        .map(line => `${indent}${line}`)
        .join('\n');
}

function joinLines(lines: string[], isPretty: boolean) {
    return lines.join(isPretty ? '\n' : ' ');
}

function indentLines(lines: string[], indentSize = 4) {
    const indent = ' '.repeat(indentSize);
    return lines.map(line => formatIndentedLines(line, indent)).join('\n');
}
