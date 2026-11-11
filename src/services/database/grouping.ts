import { escapeIdentifier, types } from 'pg';
import {
    getSelectQuery,
    getSelectQueryForRows,
    isTextSortType,
    type SelectColumns,
    type SelectQueryOptions,
    type SortOption,
} from './queryBuilder.ts';

export const MAX_GROUPING_LEVELS = 3;
const MAX_GROUPING_COMPLEXITY = 100;

const GROUP_FIELD_TYPES = new Set([
    'bigint',
    'bigserial',
    'boolean',
    'bool',
    'character varying',
    'date',
    'decimal',
    'double precision',
    'integer',
    'int',
    'int2',
    'int4',
    'int8',
    'numeric',
    'real',
    'serial',
    'smallint',
    'text',
    'time',
    'time with time zone',
    'time without time zone',
    'timestamp',
    'timestamp with time zone',
    'timestamp without time zone',
    'timestamptz',
    'uuid',
    'varchar',
]);
const NUMERIC_TYPES = new Set([
    'bigint',
    'bigserial',
    'decimal',
    'double precision',
    'integer',
    'int',
    'int2',
    'int4',
    'int8',
    'numeric',
    'real',
    'serial',
    'smallint',
]);
const STRING_NUMERIC_TYPES = new Set(['bigint', 'bigserial', 'decimal', 'int8', 'numeric']);
const TEMPORAL_TYPES = new Set([
    'date',
    'timestamp',
    'timestamp with time zone',
    'timestamp without time zone',
    'timestamptz',
]);
const DATE_BUCKET_UNITS = new Set(['day', 'week', 'month', 'quarter', 'year']);
const SUMMARY_OPERATIONS = new Set([
    'sum',
    'avg',
    'min',
    'max',
    'range',
    'median',
    'stddev',
    'count',
    'countDistinct',
    'countEmpty',
    'percentEmpty',
    'percentFilled',
    'percentUnique',
]);

export type GroupingBucket =
    | { kind: 'date'; unit: 'day' | 'week' | 'month' | 'quarter' | 'year' }
    | { kind: 'number'; size: number };

export type GroupByOption = {
    field: string[];
    direction: 'ASC' | 'DESC';
    bucket?: GroupingBucket;
};

export type SummaryOperation =
    | 'sum'
    | 'avg'
    | 'min'
    | 'max'
    | 'range'
    | 'median'
    | 'stddev'
    | 'count'
    | 'countDistinct'
    | 'countEmpty'
    | 'percentEmpty'
    | 'percentFilled'
    | 'percentUnique';

export type GroupSummaryOption = {
    id: string;
    field: string[];
    operation: SummaryOperation;
};

export type GroupPathValue = string | number | boolean | null;

export type GroupingQueryOptions = SelectQueryOptions & {
    groupBy: unknown;
    summaries?: unknown;
    groupPath?: unknown;
    groupOffset?: unknown;
    cursor?: unknown;
    groupingContext?: unknown;
    fetchGroupedRows?: unknown;
    hiddenFields?: string[];
};

type GroupingContext = {
    timezone: string;
    weekStartsOn: number;
};

type GroupCursor = {
    kind: 'group';
    depth: number;
    path: GroupPathValue[];
    value?: GroupPathValue;
    start?: boolean;
    offset?: number;
};
type RowCursor = {
    kind: 'row';
    depth: number;
    path: GroupPathValue[];
    values?: GroupPathValue[];
    start?: boolean;
    offset?: number;
};
type ParsedCursor = GroupCursor | RowCursor;

type RowOrderField = {
    field: string;
    direction: 'ASC' | 'DESC';
    ignoreCase?: boolean;
    cursorType?: 'bpchar';
};

export type GroupedLevelQuery = {
    kind: 'groups' | 'rows';
    depth: number;
    groupBy: GroupByOption[];
    groupTypes: string[];
    summaries: GroupSummaryOption[];
    summaryTypes: string[];
    path: GroupPathValue[];
    hiddenFields: string[];
    internalPrefix: string;
    limit: number;
    offset: number;
    cursor: ParsedCursor | null;
    rowOrder: RowOrderField[];
    rowOrderTypes: string[];
    groupingContext: GroupingContext;
    hydrated: boolean;
    query: string;
    params: unknown[];
};

export type SummaryQuery = {
    summaries: GroupSummaryOption[];
    summaryTypes: string[];
    internalPrefix: string;
    query: string;
    params: unknown[];
};

export class GroupingValidationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'GroupingValidationError';
    }
}

function normalizeType(type?: string) {
    return typeof type === 'string' ? type.trim().toLowerCase().replace(/\s+/g, ' ') : '';
}

function getRootField(field: unknown, label: string) {
    if (!Array.isArray(field) || field.length === 0 || field.some(segment => typeof segment !== 'string' || !segment)) {
        throw new GroupingValidationError(`${label} field must be a non-empty path`);
    }
    if (field.length > 1) {
        throw new GroupingValidationError(`${label} only supports root table fields for now`);
    }
    return field[0];
}

function parseGroupBy(input: unknown): GroupByOption[] {
    if (!Array.isArray(input) || input.length === 0) {
        throw new GroupingValidationError('groupBy must contain at least one group');
    }
    if (input.length > MAX_GROUPING_LEVELS) {
        throw new GroupingValidationError(`groupBy supports at most ${MAX_GROUPING_LEVELS} levels`);
    }

    return input.map((raw, index) => {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
            throw new GroupingValidationError(`groupBy[${index}] must be an object`);
        }
        const value = raw as Record<string, unknown>;
        const field = [getRootField(value.field, `groupBy[${index}]`)];
        const rawDirection = value.direction ?? 'ASC';
        if (typeof rawDirection !== 'string' || !['ASC', 'DESC'].includes(rawDirection.toUpperCase())) {
            throw new GroupingValidationError(`groupBy[${index}] direction must be ASC or DESC`);
        }
        const direction = rawDirection.toUpperCase() as 'ASC' | 'DESC';
        if (value.bucket === undefined || value.bucket === null) return { field, direction };
        if (typeof value.bucket !== 'object' || Array.isArray(value.bucket)) {
            throw new GroupingValidationError(`groupBy[${index}] bucket must be an object`);
        }
        const bucket = value.bucket as Record<string, unknown>;
        if (bucket.kind === 'date') {
            if (typeof bucket.unit !== 'string' || !DATE_BUCKET_UNITS.has(bucket.unit)) {
                throw new GroupingValidationError(`groupBy[${index}] has an invalid date bucket unit`);
            }
            return { field, direction, bucket: { kind: 'date', unit: bucket.unit } as GroupingBucket };
        }
        if (bucket.kind === 'number') {
            if (typeof bucket.size !== 'number' || !Number.isFinite(bucket.size) || bucket.size <= 0) {
                throw new GroupingValidationError(`groupBy[${index}] number bucket size must be greater than zero`);
            }
            return { field, direction, bucket: { kind: 'number', size: bucket.size } as GroupingBucket };
        }
        throw new GroupingValidationError(`groupBy[${index}] has an invalid bucket kind`);
    });
}

function parseSummaries(input: unknown): GroupSummaryOption[] {
    if (input === undefined || input === null) return [];
    if (!Array.isArray(input)) throw new GroupingValidationError('summaries must be an array');
    let complexity = 0;
    const ids = new Set<string>();
    return input.map((raw, index) => {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
            throw new GroupingValidationError(`summaries[${index}] must be an object`);
        }
        const value = raw as Record<string, unknown>;
        if (typeof value.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(value.id)) {
            throw new GroupingValidationError(`summaries[${index}] id must contain only letters, numbers, _ or -`);
        }
        if (ids.has(value.id)) throw new GroupingValidationError(`Summary id "${value.id}" is duplicated`);
        ids.add(value.id);
        const field = [getRootField(value.field, `summaries[${index}]`)];
        if (typeof value.operation !== 'string' || !SUMMARY_OPERATIONS.has(value.operation)) {
            throw new GroupingValidationError(`summaries[${index}] has an invalid operation`);
        }
        complexity += ['median', 'stddev', 'range', 'countDistinct', 'percentUnique'].includes(value.operation) ? 5 : 2;
        if (complexity > MAX_GROUPING_COMPLEXITY) {
            throw new GroupingValidationError('Grouped query is too complex');
        }
        return { id: value.id, field, operation: value.operation as SummaryOperation };
    });
}

function parseGroupingContext(input: unknown): GroupingContext {
    const fallback = { timezone: 'UTC', weekStartsOn: 1 };
    if (input === undefined || input === null) return fallback;
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new GroupingValidationError('groupingContext must be an object');
    }
    const value = input as Record<string, unknown>;
    const timezone = value.timezone ?? fallback.timezone;
    const weekStartsOn = value.weekStartsOn ?? fallback.weekStartsOn;
    if (typeof timezone !== 'string' || timezone.length > 128) {
        throw new GroupingValidationError('groupingContext timezone must be an IANA timezone');
    }
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format();
    } catch {
        throw new GroupingValidationError('groupingContext timezone must be an IANA timezone');
    }
    if (!Number.isInteger(weekStartsOn) || (weekStartsOn as number) < 0 || (weekStartsOn as number) > 6) {
        throw new GroupingValidationError('groupingContext weekStartsOn must be between 0 and 6');
    }
    return { timezone, weekStartsOn: weekStartsOn as number };
}

function encodeCursor(cursor: ParsedCursor) {
    return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

function parseCursor(input: unknown): ParsedCursor | null {
    if (input === undefined || input === null || input === '') return null;
    if (typeof input !== 'string' || input.length > 4096) {
        throw new GroupingValidationError('cursor must be an opaque cursor');
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(Buffer.from(input, 'base64url').toString('utf8'));
    } catch {
        throw new GroupingValidationError('cursor must be an opaque cursor');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new GroupingValidationError('cursor must be an opaque cursor');
    }
    const cursor = parsed as Record<string, unknown>;
    if (!['group', 'row'].includes(cursor.kind as string)) {
        throw new GroupingValidationError('cursor is not supported');
    }
    if (
        !Number.isInteger(cursor.depth) ||
        (cursor.depth as number) < 0 ||
        (cursor.depth as number) > MAX_GROUPING_LEVELS
    ) {
        throw new GroupingValidationError('cursor has an invalid depth');
    }
    if (!Array.isArray(cursor.path) || cursor.path.length !== cursor.depth) {
        throw new GroupingValidationError('cursor has an invalid path');
    }
    for (const value of cursor.path) {
        if (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) {
            throw new GroupingValidationError('cursor has an invalid path');
        }
    }
    if (cursor.offset !== undefined && (!Number.isSafeInteger(cursor.offset) || (cursor.offset as number) < 0)) {
        throw new GroupingValidationError('cursor has an invalid offset');
    }
    if (cursor.start !== undefined && cursor.start !== true) {
        throw new GroupingValidationError('cursor is not supported');
    }
    if (cursor.kind === 'group') {
        const value = cursor.value;
        if (!cursor.start && value !== null && !['string', 'number', 'boolean'].includes(typeof value)) {
            throw new GroupingValidationError('cursor has an invalid group value');
        }
        return cursor as GroupCursor;
    }
    if (cursor.start) return cursor as RowCursor;
    if (!Array.isArray(cursor.values)) throw new GroupingValidationError('cursor has invalid row values');
    for (const value of cursor.values) {
        if (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) {
            throw new GroupingValidationError('cursor has invalid row values');
        }
    }
    return cursor as RowCursor;
}

export function parseGroupPath(input: unknown): GroupPathValue[] {
    if (input === undefined || input === null || input === '') return [];
    let parsed = input;
    if (typeof input === 'string') {
        if (input.length > 4096) throw new GroupingValidationError('groupPath is too long');
        try {
            parsed = JSON.parse(input);
        } catch {
            throw new GroupingValidationError('groupPath must be valid JSON');
        }
    }
    if (!Array.isArray(parsed)) throw new GroupingValidationError('groupPath must be an array');
    if (parsed.length > MAX_GROUPING_LEVELS) {
        throw new GroupingValidationError(`groupPath supports at most ${MAX_GROUPING_LEVELS} values`);
    }
    for (const value of parsed) {
        if (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) {
            throw new GroupingValidationError('groupPath values must be strings, numbers, booleans or null');
        }
        if (typeof value === 'number' && !Number.isFinite(value)) {
            throw new GroupingValidationError('groupPath numbers must be finite');
        }
    }
    return parsed as GroupPathValue[];
}

function parseOffset(input: unknown, fallback = 0) {
    if (input === undefined || input === null || input === '') return fallback;
    const value = typeof input === 'number' ? input : Number(input);
    if (!Number.isInteger(value) || value < 0) {
        throw new GroupingValidationError('groupOffset must be a non-negative integer');
    }
    return value;
}

function parseLimit(input: unknown) {
    const value = typeof input === 'number' ? input : Number(input);
    if (!Number.isInteger(value) || value <= 0)
        throw new GroupingValidationError('Grouped queries require a positive limit');
    if (value > 200) throw new GroupingValidationError('Grouped queries support a maximum limit of 200');
    return value;
}

function hasAllColumns(columns: SelectColumns | undefined) {
    return (
        columns === '*' || columns === undefined || (typeof columns === 'object' && columns !== null && columns['*'])
    );
}

function getProjectedColumnNames(columns: SelectColumns | undefined) {
    if (!columns || columns === '*') return [];
    const names: string[] = [];
    for (const [key, value] of Object.entries(columns)) {
        if (key.startsWith('$')) continue;
        if (value && typeof value === 'object' && '$alias' in value && typeof value.$alias === 'string') {
            names.push(value.$alias);
        } else {
            names.push(key);
        }
    }
    return names;
}

function getInternalPrefix(options: GroupingQueryOptions) {
    const schema = options.schema || 'public';
    const tableSchema =
        options.databaseSchema?.tables?.[`${schema}.${options.table}`] ||
        (schema === 'public' ? options.databaseSchema?.tables?.[options.table] : undefined);
    const sourceNames = new Set([
        ...Object.keys(tableSchema?.columns || {}),
        ...getProjectedColumnNames(options.columns),
        ...(options.formulaCalls || []).filter(call => !call.scopeAlias).map(call => call.field),
    ]);
    for (let index = 0; ; index += 1) {
        const prefix = index === 0 ? '__ww_grouping_' : `__ww_grouping_${index}_`;
        if (![...sourceNames].some(name => name.startsWith(prefix))) return prefix;
    }
}

function internalField(prefix: string, suffix: string) {
    return `${prefix}${suffix}`;
}

export function addGroupingFieldsToColumns(
    columns: SelectColumns | undefined,
    groupBy: unknown,
    summaries?: unknown,
    sort?: SortOption[]
) {
    const parsedGroupBy = parseGroupBy(groupBy);
    const parsedSummaries = parseSummaries(summaries);
    if (hasAllColumns(columns)) return { columns, hiddenFields: [] as string[] };

    const result = { ...(columns as Record<string, unknown>) } as Record<string, true | unknown>;
    const hiddenFields: string[] = [];
    const sortFields = (sort || []).flatMap(item => {
        const path = Array.isArray(item.field) ? item.field : item.field ? [item.field] : item.key ? [item.key] : [];
        return path.length === 1 && !item.alias ? path : [];
    });
    for (const field of [
        ...parsedGroupBy.map(group => group.field[0]),
        ...parsedSummaries.map(item => item.field[0]),
        ...sortFields,
    ]) {
        if (Object.hasOwn(result, field)) continue;
        result[field] = true;
        hiddenFields.push(field);
    }
    if (!Object.hasOwn(result, 'id')) {
        result.id = true;
        hiddenFields.push('id');
    }
    return { columns: result as SelectColumns, hiddenFields };
}

export function addSummaryFieldsToColumns(columns: SelectColumns | undefined, summaries?: unknown) {
    const parsedSummaries = parseSummaries(summaries);
    if (hasAllColumns(columns)) return { columns, hiddenFields: [] as string[] };
    const result = { ...(columns as Record<string, unknown>) } as Record<string, true | unknown>;
    const hiddenFields: string[] = [];
    for (const summary of parsedSummaries) {
        const field = summary.field[0];
        if (Object.hasOwn(result, field)) continue;
        result[field] = true;
        hiddenFields.push(field);
    }
    return { columns: result as SelectColumns, hiddenFields };
}

function getColumnType(options: GroupingQueryOptions, field: string) {
    const formulaCall = options.formulaCalls?.find(call => !call.scopeAlias && call.field === field);
    if (formulaCall) return normalizeType(formulaCall.resultType.postgresType);
    const schema = options.schema || 'public';
    const tableSchema =
        options.databaseSchema?.tables?.[`${schema}.${options.table}`] ||
        (schema === 'public' ? options.databaseSchema?.tables?.[options.table] : undefined);
    return normalizeType(tableSchema?.columns?.[field]?.type);
}

function assertSummaryTypes(options: GroupingQueryOptions, summaries: GroupSummaryOption[]) {
    for (const summary of summaries) {
        const type = getColumnType(options, summary.field[0]);
        if (!type) throw new GroupingValidationError(`Unknown summary field "${summary.field[0]}"`);
        if (['count', 'countEmpty', 'percentEmpty', 'percentFilled'].includes(summary.operation)) continue;
        if (['countDistinct', 'percentUnique'].includes(summary.operation)) {
            if (type === 'json') {
                throw new GroupingValidationError(
                    `${summary.operation} does not support json field "${summary.field[0]}"`
                );
            }
            continue;
        }
        if (['sum', 'avg', 'median', 'stddev'].includes(summary.operation) && !NUMERIC_TYPES.has(type)) {
            throw new GroupingValidationError(
                `${summary.operation} requires a numeric field, but "${summary.field[0]}" is ${type}`
            );
        }
        if (
            ['min', 'max', 'range'].includes(summary.operation) &&
            !NUMERIC_TYPES.has(type) &&
            !TEMPORAL_TYPES.has(type)
        ) {
            throw new GroupingValidationError(
                `${summary.operation} requires a numeric or date field, but "${summary.field[0]}" is ${type}`
            );
        }
    }
}

function assertTypes(options: GroupingQueryOptions, groupBy: GroupByOption[], summaries: GroupSummaryOption[]) {
    for (const item of options.sort || []) {
        const path = Array.isArray(item.field) ? item.field : item.field ? [item.field] : item.key ? [item.key] : [];
        if (path.length !== 1 || item.alias) {
            throw new GroupingValidationError('Grouped row sorting only supports root table fields for now');
        }
    }
    for (let index = 0; index < groupBy.length; index += 1) {
        const group = groupBy[index];
        const type = getColumnType(options, group.field[0]);
        if (!type) throw new GroupingValidationError(`Unknown group field "${group.field[0]}"`);
        if (!GROUP_FIELD_TYPES.has(type)) {
            throw new GroupingValidationError(`Field "${group.field[0]}" cannot be grouped`);
        }
        if (group.bucket?.kind === 'date' && !TEMPORAL_TYPES.has(type)) {
            throw new GroupingValidationError(`Date buckets require a date field, but "${group.field[0]}" is ${type}`);
        }
        if (group.bucket?.kind === 'number' && !NUMERIC_TYPES.has(type)) {
            throw new GroupingValidationError(
                `Number buckets require a numeric field, but "${group.field[0]}" is ${type}`
            );
        }
    }
    assertSummaryTypes(options, summaries);
}

function assertPathTypes(options: GroupingQueryOptions, groupBy: GroupByOption[], path: GroupPathValue[]) {
    for (let index = 0; index < path.length; index += 1) {
        const value = path[index];
        if (value === null) continue;
        const group = groupBy[index];
        const type = getColumnType(options, group.field[0]);
        if (group.bucket?.kind === 'number') {
            if (typeof value !== 'number') {
                throw new GroupingValidationError(`groupPath[${index}] must be a number`);
            }
            continue;
        }
        if (STRING_NUMERIC_TYPES.has(type)) {
            if (typeof value !== 'string') {
                throw new GroupingValidationError(`groupPath[${index}] must be a string`);
            }
            continue;
        }
        if (NUMERIC_TYPES.has(type)) {
            if (typeof value !== 'number') {
                throw new GroupingValidationError(`groupPath[${index}] must be a number`);
            }
            continue;
        }
        if (type === 'boolean' || type === 'bool') {
            if (typeof value !== 'boolean') {
                throw new GroupingValidationError(`groupPath[${index}] must be a boolean`);
            }
            continue;
        }
        if (typeof value !== 'string') {
            throw new GroupingValidationError(`groupPath[${index}] must be a string`);
        }
    }
}

function escapeText(value: string) {
    return `'${value.replaceAll("'", "''")}'`;
}

function getGroupOutputType(options: GroupingQueryOptions, group: GroupByOption) {
    if (group.bucket?.kind === 'date') return 'timestamp without time zone';
    if (group.bucket?.kind === 'number') return 'double precision';
    return getColumnType(options, group.field[0]);
}

function getBucketExpressions(
    options: GroupingQueryOptions,
    groupBy: GroupByOption[],
    params: unknown[],
    internalPrefix: string,
    groupingContext: GroupingContext,
    sourceAlias = '"_ww_values"'
) {
    return groupBy.map((group, index) => {
        const source = `${sourceAlias}.${escapeIdentifier(group.field[0])}`;
        let expression = source;
        if (group.bucket?.kind === 'date') {
            const type = getColumnType(options, group.field[0]);
            const dateInput =
                type === 'timestamptz' || type === 'timestamp with time zone'
                    ? `${source} AT TIME ZONE ${escapeText(groupingContext.timezone)}`
                    : source;
            if (group.bucket.unit === 'week') {
                const weekShift = groupingContext.weekStartsOn === 0 ? -1 : groupingContext.weekStartsOn - 1;
                expression = `date_trunc('week', ${dateInput} - INTERVAL '${weekShift} days') + INTERVAL '${weekShift} days'`;
            } else {
                expression = `date_trunc(${escapeText(group.bucket.unit)}, ${dateInput})`;
            }
        } else if (group.bucket?.kind === 'number') {
            params.push(group.bucket.size);
            const placeholder = `$${params.length}::double precision`;
            expression = `floor(${source} / ${placeholder}) * ${placeholder}`;
        }
        return `${expression} AS ${escapeIdentifier(internalField(internalPrefix, `group_${index}`))}`;
    });
}

function getPathWhere(path: GroupPathValue[], params: unknown[], internalPrefix: string, sourceAlias: string) {
    if (!path.length) return '';
    const conditions = path.map((value, index) => {
        params.push(value);
        return `${sourceAlias}.${escapeIdentifier(internalField(internalPrefix, `group_${index}`))} IS NOT DISTINCT FROM $${params.length}`;
    });
    return `WHERE ${conditions.join(' AND ')}`;
}

function getSummaryExpressions(
    summary: GroupSummaryOption,
    index: number,
    internalPrefix: string,
    sourceAlias: string,
    outputPrefix = 'summary'
) {
    const field = `${sourceAlias}.${escapeIdentifier(summary.field[0])}`;
    const alias = (suffix = '') => escapeIdentifier(internalField(internalPrefix, `${outputPrefix}_${index}${suffix}`));
    switch (summary.operation) {
        case 'countDistinct':
            return [`COUNT(DISTINCT ${field}) AS ${alias()}`];
        case 'countEmpty':
            return [`COUNT(*) FILTER (WHERE ${field} IS NULL) AS ${alias()}`];
        case 'percentEmpty':
            return [
                `COALESCE(COUNT(*) FILTER (WHERE ${field} IS NULL)::double precision / NULLIF(COUNT(*), 0), 0) AS ${alias()}`,
            ];
        case 'percentFilled':
            return [`COALESCE(COUNT(${field})::double precision / NULLIF(COUNT(*), 0), 0) AS ${alias()}`];
        case 'percentUnique':
            return [
                `COALESCE(COUNT(DISTINCT ${field})::double precision / NULLIF(COUNT(${field}), 0), 0) AS ${alias()}`,
            ];
        case 'median':
            return [`PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ${field}) AS ${alias()}`];
        case 'stddev':
            return [`STDDEV_SAMP(${field}) AS ${alias()}`];
        case 'range':
            return [`MIN(${field}) AS ${alias('_lower')}`, `MAX(${field}) AS ${alias('_upper')}`];
        default:
            return [`${summary.operation.toUpperCase()}(${field}) AS ${alias()}`];
    }
}

function getSummaryJsonValue(summary: GroupSummaryOption, sourceAlias: string) {
    const field = `${sourceAlias}.${escapeIdentifier(summary.field[0])}`;
    switch (summary.operation) {
        case 'countDistinct':
            return `COUNT(DISTINCT ${field})`;
        case 'countEmpty':
            return `COUNT(*) FILTER (WHERE ${field} IS NULL)`;
        case 'percentEmpty':
            return `COALESCE(COUNT(*) FILTER (WHERE ${field} IS NULL)::double precision / NULLIF(COUNT(*), 0), 0)`;
        case 'percentFilled':
            return `COALESCE(COUNT(${field})::double precision / NULLIF(COUNT(*), 0), 0)`;
        case 'percentUnique':
            return `COALESCE(COUNT(DISTINCT ${field})::double precision / NULLIF(COUNT(${field}), 0), 0)`;
        case 'median':
            return `PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ${field})`;
        case 'stddev':
            return `STDDEV_SAMP(${field})`;
        case 'range':
            return `jsonb_build_object('lower', MIN(${field}), 'upper', MAX(${field}))`;
        default:
            return `${summary.operation.toUpperCase()}(${field})`;
    }
}

function getSummariesJson(summaries: GroupSummaryOption[], sourceAlias: string) {
    if (!summaries.length) return `'{}'::jsonb`;
    return `jsonb_build_object(${summaries
        .flatMap(summary => [escapeText(summary.id), getSummaryJsonValue(summary, sourceAlias)])
        .join(', ')})`;
}

function getHydrationPathValueExpression(
    options: GroupingQueryOptions,
    group: GroupByOption,
    depth: number,
    sourceAlias: string
) {
    const field = `${sourceAlias}.${escapeIdentifier(internalField(getInternalPrefix(options), `group_${depth}`))}`;
    const type = getGroupOutputType(options, group);
    if (
        group.bucket?.kind === 'date' ||
        STRING_NUMERIC_TYPES.has(type) ||
        TEMPORAL_TYPES.has(type) ||
        type.startsWith('time')
    )
        return `${field}::text`;
    return field;
}

function getCursorJsonValueExpression(type: string, field: string) {
    if (STRING_NUMERIC_TYPES.has(type) || TEMPORAL_TYPES.has(type) || type.startsWith('time')) return `${field}::text`;
    return field;
}

function getGroupPathValueExpression(
    options: GroupingQueryOptions,
    group: GroupByOption,
    groupAlias: string,
    sourceAlias: string
) {
    const expression = `${sourceAlias}.${groupAlias}`;
    const type = getColumnType(options, group.field[0]);
    if (
        group.bucket?.kind === 'date' ||
        (group.bucket?.kind !== 'number' && STRING_NUMERIC_TYPES.has(type)) ||
        TEMPORAL_TYPES.has(type) ||
        type.startsWith('time')
    ) {
        return `${expression}::text`;
    }
    return expression;
}

function getRootTotalExpression(internalPrefix: string, sourceAlias = '"_ww_filtered_rows"') {
    const rootGroup = escapeIdentifier(internalField(internalPrefix, 'group_0'));
    return `(SELECT COUNT(*) FROM (SELECT ${sourceAlias}.${rootGroup} FROM ${sourceAlias} GROUP BY ${sourceAlias}.${rootGroup}) AS "_ww_roots")`;
}

function getGroupingStageFieldNames(
    options: GroupingQueryOptions,
    groupBy: GroupByOption[],
    summaries: GroupSummaryOption[]
) {
    const fields = new Set(['id']);
    for (const group of groupBy) fields.add(group.field[0]);
    for (const summary of summaries) fields.add(summary.field[0]);
    for (const order of getRowOrder(options.sort, options)) fields.add(order.field);
    for (const include of options.includes || []) {
        if (!include.fromAlias && include.on?.left) fields.add(include.on.left);
    }
    return fields;
}

function getFilteredRowsQuery(
    options: GroupingQueryOptions,
    groupBy: GroupByOption[],
    summaries: GroupSummaryOption[],
    internalPrefix: string,
    groupingContext: GroupingContext
) {
    // Keep the shared stage narrow: grouping, summaries, ordering and filters do not need display payloads.
    const columns: SelectColumns = {};
    // Output-only formulas belong to the bounded payload stage, not the full filtered set.
    for (const field of getGroupingStageFieldNames(options, groupBy, summaries)) columns[field] = true;
    const base = getSelectQuery({
        schema: options.schema,
        table: options.table,
        columns,
        filters: options.filters,
        includes: options.includes,
        format: 'pretty',
        databaseSchema: options.databaseSchema,
        formulaCalls: options.formulaCalls,
        formulaInputs: options.formulaInputs,
    });
    const params = [...base.params];
    const bucketExpressions = getBucketExpressions(options, groupBy, params, internalPrefix, groupingContext);
    return {
        query: `SELECT "_ww_values".*, ${bucketExpressions.join(', ')}\n    FROM (\n${base.query
            .split('\n')
            .map(line => `        ${line}`)
            .join('\n')}\n    ) AS "_ww_values"`,
        params,
    };
}

function shiftQueryParams(query: string, offset: number) {
    if (!offset) return query;
    return query.replace(/\$(\d+)/g, (_, index: string) => `$${Number(index) + offset}`);
}

function getPayloadQuery(options: GroupingQueryOptions, params: unknown[]) {
    // Full relation payloads are generated only after the bounded row selection has been materialized.
    const payload = getSelectQueryForRows(
        {
            schema: options.schema,
            table: options.table,
            columns: options.columns,
            includes: options.includes,
            format: 'pretty',
            databaseSchema: options.databaseSchema,
            formulaCalls: options.formulaCalls,
            formulaInputs: options.formulaInputs,
        },
        { relation: '_ww_selected_rows', sourceField: 'id', relationField: 'id' }
    );
    const query = shiftQueryParams(payload.query, params.length);
    params.push(...payload.params);
    return query;
}

function getBaseQuery(options: GroupingQueryOptions) {
    return getSelectQuery({
        schema: options.schema,
        table: options.table,
        columns: options.columns,
        filters: options.filters,
        includes: options.includes,
        format: 'pretty',
        databaseSchema: options.databaseSchema,
        formulaCalls: options.formulaCalls,
        formulaInputs: options.formulaInputs,
    });
}

function getRowOrder(sort: SortOption[] | undefined, options: GroupingQueryOptions): RowOrderField[] {
    const fields: RowOrderField[] = [];
    for (const option of sort || []) {
        const path = Array.isArray(option.field)
            ? option.field
            : option.field
              ? [option.field]
              : option.key
                ? [option.key]
                : [];
        if (path.length !== 1 || option.alias) {
            throw new GroupingValidationError('Grouped row sorting only supports root table fields for now');
        }
        const direction = option.direction?.toUpperCase() || 'ASC';
        if (!['ASC', 'DESC'].includes(direction)) throw new GroupingValidationError(`Invalid sort order: ${direction}`);
        const columnType = getColumnType(options, path[0]);
        const ignoreCase = option.ignoreCase === true && isTextSortType(columnType);
        const isPaddedText = ['character', 'char', 'bpchar'].includes(columnType.replace(/\(\d+\)$/, '').trim());
        fields.push({
            field: path[0],
            direction: direction as 'ASC' | 'DESC',
            ...(ignoreCase ? { ignoreCase: true } : {}),
            ...(ignoreCase && isPaddedText ? { cursorType: 'bpchar' as const } : {}),
        });
    }
    if (!fields.some(item => item.field === 'id' && !item.ignoreCase)) {
        fields.push({ field: 'id', direction: 'ASC' });
    }
    return fields;
}

function getRowOrderSql(rowOrder: RowOrderField[], sourceAlias: string) {
    return rowOrder.map(item => `${getRowOrderExpression(item, sourceAlias)} ${item.direction} NULLS LAST`).join(', ');
}

function getRowOrderExpression(item: RowOrderField, sourceAlias: string): string {
    const field = `${sourceAlias}.${escapeIdentifier(item.field)}`;
    return item.ignoreCase ? `LOWER(${field})` : field;
}

function getGroupCursorWhere(cursor: GroupCursor | null, direction: 'ASC' | 'DESC', params: unknown[]) {
    if (!cursor) return '';
    if (cursor.value === null) return 'WHERE FALSE';
    if (cursor.value === undefined) throw new GroupingValidationError('cursor has an invalid group value');
    params.push(cursor.value);
    const operator = direction === 'ASC' ? '>' : '<';
    return `WHERE ("value" ${operator} $${params.length} OR "value" IS NULL)`;
}

function getRowCursorWhere(
    cursor: RowCursor | null,
    rowOrder: RowOrderField[],
    params: unknown[],
    sourceAlias: string
) {
    if (!cursor) return '';
    if (!cursor.values) throw new GroupingValidationError('cursor has invalid row values');
    if (cursor.values.length !== rowOrder.length) {
        throw new GroupingValidationError('cursor does not match the row order');
    }
    const conditions: string[] = [];
    const equalities: string[] = [];
    for (let index = 0; index < rowOrder.length; index += 1) {
        const item = rowOrder[index];
        const value = cursor.values[index];
        const field = getRowOrderExpression(item, sourceAlias);
        params.push(value);
        const placeholder = item.ignoreCase
            ? `LOWER($${params.length}::${item.cursorType || 'text'})`
            : `$${params.length}`;
        if (value !== null) {
            const operator = item.direction === 'ASC' ? '>' : '<';
            conditions.push([...equalities, `(${field} ${operator} ${placeholder} OR ${field} IS NULL)`].join(' AND '));
        }
        equalities.push(`${field} IS NOT DISTINCT FROM ${placeholder}`);
    }
    return conditions.length ? `WHERE (${conditions.map(condition => `(${condition})`).join(' OR ')})` : 'WHERE FALSE';
}

export function getSummaryQuery(options: Omit<GroupingQueryOptions, 'groupBy'> & { summaries: unknown }): SummaryQuery {
    const summaries = parseSummaries(options.summaries);
    if (!summaries.length) throw new GroupingValidationError('summaries must contain at least one entry');
    assertSummaryTypes(options as GroupingQueryOptions, summaries);
    const internalPrefix = getInternalPrefix(options as GroupingQueryOptions);
    const base = getBaseQuery(options as GroupingQueryOptions);
    const expressions = summaries.flatMap((summary, index) =>
        getSummaryExpressions(summary, index, internalPrefix, '"_ww_source"')
    );
    return {
        summaries,
        summaryTypes: summaries.map(summary => getColumnType(options as GroupingQueryOptions, summary.field[0])),
        internalPrefix,
        query: `WITH "_ww_source" AS MATERIALIZED (\n${base.query}\n)\nSELECT ${expressions.join(', ')}\nFROM "_ww_source"`,
        params: base.params,
    };
}

const HYDRATED_LEAF_LIMIT = 10;
const HYDRATED_ROW_LIMIT = 30;
const MAX_HYDRATED_ROWS_BYTES = 2 * 1024 * 1024;

function addHydrationPathSelectionCtes({
    ctes,
    groupAliases,
    groupBy,
    hasItemAlias,
    limitParam,
    pathOrderAlias,
}: {
    ctes: string[];
    groupAliases: string[];
    groupBy: GroupByOption[];
    hasItemAlias: string;
    limitParam: string;
    pathOrderAlias: string;
}) {
    const pathAliases = groupAliases.map((_, depth) => escapeIdentifier(`g${depth}`));
    const pathOrder = pathAliases.map((alias, depth) => `${alias} ${groupBy[depth].direction} NULLS LAST`).join(', ');
    ctes.push(`"_ww_visible_roots" AS MATERIALIZED (
    SELECT "value"
    FROM "_ww_group_page"
    WHERE ${hasItemAlias} IS TRUE
    ORDER BY "value" ${groupBy[0].direction} NULLS LAST
    LIMIT ${limitParam}
)`);
    ctes.push(`"_ww_hydration_level_0" AS (
    SELECT "value" AS "g0"
    FROM "_ww_visible_roots"
    ORDER BY "value" ${groupBy[0].direction} NULLS LAST
    LIMIT ${HYDRATED_LEAF_LIMIT}
)`);

    for (let depth = 1; depth < groupBy.length; depth++) {
        const aliases = pathAliases.slice(0, depth + 1).join(', ');
        const parentJoin = groupAliases
            .slice(0, depth)
            .map(
                (alias, index) =>
                    `"_ww_filtered_rows".${alias} IS NOT DISTINCT FROM "_ww_parent_paths".${pathAliases[index]}`
            )
            .join(' AND ');
        const fields = groupAliases
            .slice(0, depth + 1)
            .map((alias, index) => `"_ww_filtered_rows".${alias} AS ${pathAliases[index]}`)
            .join(', ');
        const groupFields = groupAliases
            .slice(0, depth + 1)
            .map(alias => `"_ww_filtered_rows".${alias}`)
            .join(', ');
        // Select each parent's first child page before row payloads or relation/formula work.
        ctes.push(`"_ww_hydration_level_${depth}" AS (
    SELECT ${aliases}
    FROM (
        SELECT ${aliases},
            ROW_NUMBER() OVER (PARTITION BY ${pathAliases.slice(0, depth).join(', ')} ORDER BY ${pathAliases[depth]} ${groupBy[depth].direction} NULLS LAST) AS "child_rank"
        FROM (
            SELECT ${fields}
            FROM "_ww_filtered_rows"
            INNER JOIN "_ww_hydration_level_${depth - 1}" AS "_ww_parent_paths" ON ${parentJoin}
            GROUP BY ${groupFields}
        ) AS "_ww_child_paths"
    ) AS "_ww_ranked_paths"
    WHERE "child_rank" <= ${limitParam}
)`);
    }

    // The global leaf budget remains independent of the page size of each parent.
    ctes.push(`"_ww_hydration_paths" AS MATERIALIZED (
    SELECT *, ROW_NUMBER() OVER (ORDER BY ${pathOrder}) AS ${pathOrderAlias}
    FROM "_ww_hydration_level_${groupBy.length - 1}"
    ORDER BY ${pathOrder}
    LIMIT ${HYDRATED_LEAF_LIMIT}
)`);
}

function addSelectedRowHydrationCtes({
    ctes,
    options,
    groupBy,
    summaries,
    rowOrder,
    rowOrderTypes,
    internalPrefix,
    params,
    limit,
}: {
    ctes: string[];
    options: GroupingQueryOptions;
    groupBy: GroupByOption[];
    summaries: GroupSummaryOption[];
    rowOrder: RowOrderField[];
    rowOrderTypes: string[];
    internalPrefix: string;
    params: unknown[];
    limit: number;
}) {
    const source = '"_ww_filtered_rows"';
    const groupAliases = groupBy.map((_, depth) => escapeIdentifier(internalField(internalPrefix, `group_${depth}`)));
    const pathJoin = (rowAlias: string, pathAlias: string, depth = groupBy.length) =>
        Array.from(
            { length: depth },
            (_, index) =>
                `${rowAlias}.${groupAliases[index]} IS NOT DISTINCT FROM ${pathAlias}.${escapeIdentifier(`g${index}`)}`
        ).join(' AND ');
    const pathValues = (rowAlias: string, depth = groupBy.length) =>
        Array.from({ length: depth }, (_, index) =>
            getHydrationPathValueExpression(options, groupBy[index], index, rowAlias)
        );
    const rootAlias = groupAliases[0];
    const hasItemAlias = escapeIdentifier(internalField(internalPrefix, 'has_item'));

    const leafDepth = groupBy.length - 1;
    const leafPathValues = pathValues(source);
    const rowNumberAlias = escapeIdentifier(internalField(internalPrefix, 'hydration_row_number'));
    const cursorValuesAlias = escapeIdentifier(internalField(internalPrefix, 'hydration_cursor_values'));
    const pathOrderAlias = escapeIdentifier(internalField(internalPrefix, 'hydration_path_order'));
    const rowOrderSql = getRowOrderSql(rowOrder, source);
    const cursorValues = rowOrder.map((item, index) =>
        getCursorJsonValueExpression(rowOrderTypes[index], `${source}.${escapeIdentifier(item.field)}`)
    );
    params.push(limit);
    addHydrationPathSelectionCtes({
        ctes,
        groupAliases,
        groupBy,
        hasItemAlias,
        limitParam: `$${params.length}`,
        pathOrderAlias,
    });
    ctes.push(`"_ww_selected_rows" AS MATERIALIZED (
    SELECT *
    FROM (
        SELECT ${source}.*,
            "_ww_selected_paths".${pathOrderAlias},
            ROW_NUMBER() OVER (PARTITION BY ${groupAliases.map(alias => `${source}.${alias}`).join(', ')} ORDER BY ${rowOrderSql}) AS ${rowNumberAlias},
            jsonb_build_array(${cursorValues.join(', ')}) AS ${cursorValuesAlias}
        FROM ${source}
        INNER JOIN "_ww_hydration_paths" AS "_ww_selected_paths" ON ${pathJoin(source, '"_ww_selected_paths"')}
    ) AS "_ww_ranked_rows"
    WHERE "_ww_ranked_rows".${rowNumberAlias} <= ${HYDRATED_ROW_LIMIT + 1}
)`);

    // Count child groups, including null, without materializing their row payloads.
    const childCounts = [];
    for (let depth = 0; depth < leafDepth; depth++) {
        const prefix = groupAliases.slice(0, depth + 1).map(alias => `${source}.${alias}`);
        const visibleParentJoin =
            depth === 0
                ? `INNER JOIN "_ww_visible_roots" ON ${source}.${rootAlias} IS NOT DISTINCT FROM "_ww_visible_roots"."value"`
                : `INNER JOIN (
                SELECT DISTINCT ${Array.from({ length: depth + 1 }, (_, index) => escapeIdentifier(`g${index}`)).join(', ')}
                FROM "_ww_hydration_paths"
            ) AS "_ww_visible_parents" ON ${pathJoin(source, '"_ww_visible_parents"', depth + 1)}`;
        childCounts.push(`SELECT jsonb_build_array(${pathValues(source, depth + 1).join(', ')}) AS "path",
            COUNT(DISTINCT jsonb_build_array(${source}.${groupAliases[depth + 1]})) AS "total"
            FROM ${source}
            ${visibleParentJoin}
            GROUP BY ${prefix.join(', ')}`);
    }
    ctes.push(`"_ww_child_counts" AS (
        SELECT ${childCounts.length ? `COALESCE(jsonb_object_agg("path"::text, "total"), '{}'::jsonb) FROM (${childCounts.join(' UNION ALL ')}) AS "_ww_counts"` : "'{}'::jsonb"}
    )`);
    const nodeQueries: string[] = [];
    for (let depth = 1; depth < leafDepth; depth += 1) {
        const nodeSource = '"_ww_filtered_rows"';
        const nodePathValues = pathValues(nodeSource, depth + 1);
        const selectedPathColumns = groupAliases
            .slice(0, depth + 1)
            .map((alias, index) => `"_ww_selected_rows".${alias} AS ${escapeIdentifier(`g${index}`)}`);
        nodeQueries.push(`SELECT ${depth} AS "depth",
        MIN("_ww_selected_paths".${pathOrderAlias}) AS "selection_order",
        jsonb_build_array(${nodePathValues.join(', ')}) AS "path",
        to_jsonb(${nodePathValues[depth]}) AS "value",
        COUNT(*) AS "count",
        ${getSummariesJson(summaries, nodeSource)} AS "summaries",
        NULL::jsonb AS "rows",
        FALSE AS "rows_has_more",
        NULL::jsonb AS "row_cursor_values"
    FROM ${nodeSource}
    INNER JOIN (
        SELECT ${selectedPathColumns.join(', ')}, MIN(${pathOrderAlias}) AS ${pathOrderAlias}
        FROM "_ww_selected_rows"
        GROUP BY ${groupAliases.slice(0, depth + 1).join(', ')}
    ) AS "_ww_selected_paths"
        ON ${pathJoin(nodeSource, '"_ww_selected_paths"', depth + 1)}
    GROUP BY ${groupAliases
        .slice(0, depth + 1)
        .map(alias => `${nodeSource}.${alias}`)
        .join(', ')}`);
    }

    const fieldsToRemove = [...(options.hiddenFields || [])];
    const removeFieldsSql = `ARRAY[${fieldsToRemove.map(escapeText).join(', ')}]::text[]`;
    const selectedLeafPathColumns = groupAliases.map(
        (alias, index) => `"_ww_selected_rows".${alias} AS ${escapeIdentifier(`g${index}`)}`
    );
    const payloadQuery = getPayloadQuery(options, params);
    nodeQueries.push(`SELECT ${leafDepth} AS "depth",
        "_ww_leaf_stats"."selection_order",
        "_ww_leaf_stats"."path",
        to_jsonb("_ww_leaf_stats"."value") AS "value",
        "_ww_leaf_stats"."count",
        "_ww_leaf_stats"."summaries",
        COALESCE(jsonb_agg(to_jsonb("_ww_payload_rows") - ${removeFieldsSql} ORDER BY "_ww_selected_rows".${rowNumberAlias}) FILTER (WHERE "_ww_selected_rows".${rowNumberAlias} <= ${HYDRATED_ROW_LIMIT}), '[]'::jsonb) AS "rows",
        "_ww_leaf_stats"."count" > ${HYDRATED_ROW_LIMIT} AS "rows_has_more",
        (jsonb_agg("_ww_selected_rows".${cursorValuesAlias} ORDER BY "_ww_selected_rows".${rowNumberAlias}) FILTER (WHERE "_ww_selected_rows".${rowNumberAlias} <= ${HYDRATED_ROW_LIMIT}))->-1 AS "row_cursor_values"
    FROM (
        SELECT
            MIN("_ww_selected_paths".${pathOrderAlias}) AS "selection_order",
            jsonb_build_array(${leafPathValues.join(', ')}) AS "path",
            ${leafPathValues[leafDepth]} AS "value",
            COUNT(*) AS "count",
            ${getSummariesJson(summaries, source)} AS "summaries"
        FROM ${source}
        INNER JOIN (
            SELECT ${selectedLeafPathColumns.join(', ')}, MIN(${pathOrderAlias}) AS ${pathOrderAlias}
            FROM "_ww_selected_rows"
            GROUP BY ${groupAliases.join(', ')}
        ) AS "_ww_selected_paths"
            ON ${pathJoin(source, '"_ww_selected_paths"')}
        GROUP BY ${groupAliases.map(alias => `${source}.${alias}`).join(', ')}
    ) AS "_ww_leaf_stats"
    LEFT JOIN "_ww_selected_rows" ON jsonb_build_array(${pathValues('"_ww_selected_rows"').join(', ')}) = "_ww_leaf_stats"."path"
    LEFT JOIN (
${payloadQuery
    .split('\n')
    .map(line => `        ${line}`)
    .join('\n')}
    ) AS "_ww_payload_rows" ON "_ww_payload_rows"."id" = "_ww_selected_rows"."id"
    GROUP BY "_ww_leaf_stats"."path", "_ww_leaf_stats"."value", "_ww_leaf_stats"."count", "_ww_leaf_stats"."summaries", "_ww_leaf_stats"."selection_order"`);

    ctes.push(`"_ww_hydration" AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'depth', "depth",
        'path', "path",
        'value', "value",
        'count', "count",
        'summaries', "summaries",
        'rows', "rows",
        'rowsHasMore', "rows_has_more",
        'rowCursorValues', "row_cursor_values"
    ) ORDER BY "depth", "selection_order"), '[]'::jsonb) AS ${escapeIdentifier(internalField(internalPrefix, 'hydrated_nodes'))}
    FROM (
        ${nodeQueries.join('\n        UNION ALL\n        ')}
    ) AS "_ww_hydrated_nodes"
)`);
}

export function getGroupedQuery(options: GroupingQueryOptions): GroupedLevelQuery {
    const groupBy = parseGroupBy(options.groupBy);
    const summaries = parseSummaries(options.summaries);
    const cursor = parseCursor(options.cursor);
    const path = options.groupPath === undefined ? cursor?.path || [] : parseGroupPath(options.groupPath);
    if (path.length > groupBy.length) throw new GroupingValidationError('groupPath is deeper than groupBy');
    const expectedCursorKind = path.length < groupBy.length ? 'group' : 'row';
    if (cursor && (cursor.kind !== expectedCursorKind || cursor.depth !== path.length)) {
        throw new GroupingValidationError('cursor does not match the requested group level');
    }
    assertTypes(options, groupBy, summaries);
    assertPathTypes(options, groupBy, path);
    const groupTypes = groupBy.map(group => getGroupOutputType(options, group));
    const summaryTypes = summaries.map(summary => getColumnType(options, summary.field[0]));
    const internalPrefix = getInternalPrefix(options);
    const groupingContext = parseGroupingContext(options.groupingContext);
    const limit = parseLimit(options.limit);
    const offset = cursor && !cursor.start ? (cursor.offset ?? 0) : parseOffset(options.offset ?? options.groupOffset);
    const queryOffset = cursor && !cursor.start ? 0 : offset;
    const filteredRows = getFilteredRowsQuery(options, groupBy, summaries, internalPrefix, groupingContext);
    const params = [...filteredRows.params];
    const pathWhere = getPathWhere(path, params, internalPrefix, '"_ww_filtered_rows"');
    const rowOrder = getRowOrder(options.sort, options);
    const rowOrderTypes = rowOrder.map(item => getColumnType(options, item.field));
    const hydrated = options.fetchGroupedRows === true && path.length === 0;
    const ctes = [`"_ww_filtered_rows" AS MATERIALIZED (\n    ${filteredRows.query}\n)`];

    if (path.length < groupBy.length) {
        const depth = path.length;
        const groupAlias = escapeIdentifier(internalField(internalPrefix, `group_${depth}`));
        const pathValueAlias = escapeIdentifier(internalField(internalPrefix, 'path_value'));
        const hasItemAlias = escapeIdentifier(internalField(internalPrefix, 'has_item'));
        const rootTotalAlias = escapeIdentifier(internalField(internalPrefix, 'root_total'));
        const totalRowsAlias = escapeIdentifier(internalField(internalPrefix, 'total_rows'));
        const levelTotalAlias = escapeIdentifier(internalField(internalPrefix, 'level_total'));
        const pathValueExpression = getGroupPathValueExpression(
            options,
            groupBy[depth],
            groupAlias,
            '"_ww_filtered_rows"'
        );
        const summaryExpressions = summaries.flatMap((summary, index) =>
            getSummaryExpressions(summary, index, internalPrefix, '"_ww_filtered_rows"')
        );
        const groupCursorWhere = getGroupCursorWhere(
            cursor?.start ? null : (cursor as GroupCursor | null),
            groupBy[depth].direction,
            params
        );
        params.push(limit + 1, queryOffset);
        const limitParam = `$${params.length - 1}`;
        const offsetParam = `$${params.length}`;
        ctes.push(
            `"_ww_group_page" AS (\n    SELECT TRUE AS ${hasItemAlias}, *\n    FROM (\n        SELECT "_ww_filtered_rows".${groupAlias} AS "value", ${pathValueExpression} AS ${pathValueAlias}, COUNT(*) AS "count"${
                summaryExpressions.length ? `, ${summaryExpressions.join(', ')}` : ''
            }\n        FROM "_ww_filtered_rows"\n        ${pathWhere}\n        GROUP BY "_ww_filtered_rows".${groupAlias}\n    ) AS "_ww_grouped_rows"\n    ${groupCursorWhere}\n    ORDER BY "value" ${groupBy[depth].direction} NULLS LAST\n    LIMIT ${limitParam}\n    OFFSET ${offsetParam}\n)`
        );
        if (hydrated) {
            addSelectedRowHydrationCtes({
                ctes,
                options,
                groupBy,
                summaries,
                rowOrder,
                rowOrderTypes,
                internalPrefix,
                params,
                limit,
            });
        }
        const globalSummaryExpressions = summaries.flatMap((summary, index) =>
            getSummaryExpressions(summary, index, internalPrefix, '"_ww_filtered_rows"', 'global_summary')
        );
        const levelTotalExpression = `(SELECT COUNT(*) FROM (SELECT "_ww_filtered_rows".${groupAlias} FROM "_ww_filtered_rows" ${pathWhere} GROUP BY "_ww_filtered_rows".${groupAlias}) AS "_ww_level_groups")`;
        let statsQuery = `SELECT\n        ${getRootTotalExpression(internalPrefix)} AS ${rootTotalAlias},\n        (SELECT COUNT(*) FROM "_ww_filtered_rows") AS ${totalRowsAlias},\n        ${levelTotalExpression} AS ${levelTotalAlias}`;
        if (globalSummaryExpressions.length) {
            statsQuery = `${statsQuery},\n        ${globalSummaryExpressions.join(',\n        ')}\n    FROM "_ww_filtered_rows"`;
        }
        const query = `WITH ${ctes.join(',\n')}\nSELECT "_ww_group_page".*, "_ww_stats".*${
            hydrated
                ? `, "_ww_hydration".*, (SELECT * FROM "_ww_child_counts") AS ${escapeIdentifier(internalField(internalPrefix, 'child_totals'))}`
                : ''
        }\nFROM (\n    ${statsQuery}\n) AS "_ww_stats"\nLEFT JOIN "_ww_group_page" ON TRUE${hydrated ? '\nCROSS JOIN "_ww_hydration"' : ''}\nORDER BY "_ww_group_page"."value" ${groupBy[depth].direction} NULLS LAST`;
        return {
            kind: 'groups',
            depth,
            groupBy,
            groupTypes,
            summaries,
            summaryTypes,
            path,
            hiddenFields: options.hiddenFields || [],
            internalPrefix,
            limit,
            offset,
            cursor,
            rowOrder,
            rowOrderTypes,
            groupingContext,
            hydrated,
            query,
            params,
        };
    }

    const rowOrderSql = getRowOrderSql(rowOrder, '"_ww_filtered_rows"');
    const rowCursorWhere = getRowCursorWhere(
        cursor?.start ? null : (cursor as RowCursor | null),
        rowOrder,
        params,
        '"_ww_filtered_rows"'
    );
    const rowWhere = [pathWhere, rowCursorWhere]
        .filter(Boolean)
        .map(clause => `(${clause.replace(/^WHERE /, '')})`)
        .join(' AND ');
    const rowLimit = limit + 1;
    params.push(rowLimit, queryOffset);
    const limitParam = `$${params.length - 1}`;
    const offsetParam = `$${params.length}`;
    const hasItemAlias = escapeIdentifier(internalField(internalPrefix, 'has_item'));
    const rowOrderAlias = escapeIdentifier(internalField(internalPrefix, 'row_order'));
    const rootTotalAlias = escapeIdentifier(internalField(internalPrefix, 'root_total'));
    const totalRowsAlias = escapeIdentifier(internalField(internalPrefix, 'total_rows'));
    const levelTotalAlias = escapeIdentifier(internalField(internalPrefix, 'level_total'));
    const hasMoreAlias = escapeIdentifier(internalField(internalPrefix, 'has_more'));
    const nextOffsetAlias = escapeIdentifier(internalField(internalPrefix, 'next_offset'));
    ctes.push(
        `"_ww_selected_rows" AS MATERIALIZED (\n    SELECT "_ww_filtered_rows".*, ROW_NUMBER() OVER (ORDER BY ${rowOrderSql}) AS ${rowOrderAlias}\n    FROM "_ww_filtered_rows"\n    ${rowWhere ? `WHERE ${rowWhere}` : ''}\n    ORDER BY ${rowOrderSql}\n    LIMIT ${limitParam}\n    OFFSET ${offsetParam}\n)`
    );
    ctes.push(
        `"_ww_payload_rows" AS (\n${getPayloadQuery(options, params)
            .split('\n')
            .map(line => `    ${line}`)
            .join('\n')}\n)`
    );
    const globalSummaryExpressions = summaries.flatMap((summary, index) =>
        getSummaryExpressions(summary, index, internalPrefix, '"_ww_filtered_rows"', 'global_summary')
    );
    const statsQuery = `SELECT\n        ${getRootTotalExpression(internalPrefix)} AS ${rootTotalAlias},\n        (SELECT COUNT(*) FROM "_ww_filtered_rows") AS ${totalRowsAlias},\n        (SELECT COUNT(*) FROM "_ww_filtered_rows" ${pathWhere}) AS ${levelTotalAlias},\n        ((SELECT COUNT(*) FROM "_ww_selected_rows") > ${limit}) AS ${hasMoreAlias},\n        CASE WHEN (SELECT COUNT(*) FROM "_ww_selected_rows") > ${limit} THEN ${offset + limit} ELSE NULL END AS ${nextOffsetAlias}${
        globalSummaryExpressions.length ? `,\n        ${globalSummaryExpressions.join(',\n        ')}` : ''
    }${globalSummaryExpressions.length ? '\n    FROM "_ww_filtered_rows"' : ''}`;
    const groupFields = groupBy.map((_, index) => escapeIdentifier(internalField(internalPrefix, `group_${index}`)));
    const query = `WITH ${ctes.join(',\n')}\nSELECT ("_ww_selected_rows".${rowOrderAlias} IS NOT NULL) AS ${hasItemAlias}, "_ww_payload_rows".*, "_ww_selected_rows".${rowOrderAlias}, ${groupFields
        .map(field => `"_ww_selected_rows".${field}`)
        .join(
            ', '
        )}, "_ww_stats".*\nFROM (\n    ${statsQuery}\n) AS "_ww_stats"\nLEFT JOIN "_ww_selected_rows" ON TRUE\nLEFT JOIN "_ww_payload_rows" ON "_ww_payload_rows"."id" = "_ww_selected_rows"."id"\nORDER BY "_ww_selected_rows".${rowOrderAlias} ASC NULLS LAST`;
    return {
        kind: 'rows',
        depth: path.length,
        groupBy,
        groupTypes,
        summaries,
        summaryTypes,
        path,
        hiddenFields: options.hiddenFields || [],
        internalPrefix,
        limit,
        offset,
        cursor,
        rowOrder,
        rowOrderTypes,
        groupingContext,
        hydrated: false,
        query,
        params,
    };
}

function toNumber(value: unknown) {
    const number = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(number) ? number : 0;
}

function getNodeId(path: GroupPathValue[]) {
    return Buffer.from(JSON.stringify(path)).toString('base64url');
}

function getLabel(value: GroupPathValue | Date) {
    if (value === null) return 'Empty';
    if (value === '') return 'Empty text';
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'boolean') return value ? 'True' : 'False';
    return `${value}`;
}

function padDatePart(value: number, length = 2) {
    return `${value}`.padStart(length, '0');
}

function formatNaiveTimestamp(value: Date) {
    const milliseconds = value.getMilliseconds();
    return `${padDatePart(value.getFullYear(), 4)}-${padDatePart(value.getMonth() + 1)}-${padDatePart(value.getDate())}T${padDatePart(value.getHours())}:${padDatePart(value.getMinutes())}:${padDatePart(value.getSeconds())}${milliseconds ? `.${padDatePart(milliseconds, 3)}` : ''}`;
}

function parseTemporalValue(value: unknown, type: string): unknown {
    if (typeof value !== 'string') return value;
    const oid =
        type === 'date'
            ? 1082
            : type === 'timestamp' || type === 'timestamp without time zone'
              ? 1114
              : type === 'timestamptz' || type === 'timestamp with time zone'
                ? 1184
                : null;
    return oid ? types.getTypeParser(oid)(value.replace('T', ' ').replace(/Z$/, '+00')) : value;
}

function formatTypedValue(value: unknown, type: string): GroupPathValue | undefined {
    value = parseTemporalValue(value, type);
    if (value === undefined) return undefined;
    if (value === null) return null;
    if (!(value instanceof Date)) return value as GroupPathValue;
    if (type === 'date') {
        return `${padDatePart(value.getFullYear(), 4)}-${padDatePart(value.getMonth() + 1)}-${padDatePart(value.getDate())}`;
    }
    if (type === 'timestamp' || type === 'timestamp without time zone') return formatNaiveTimestamp(value);
    return value.toISOString();
}

function formatGroupValue(plan: GroupedLevelQuery, value: unknown): GroupPathValue {
    const type = plan.groupTypes[plan.depth];
    value = parseTemporalValue(value, type);
    if (!(value instanceof Date)) return value as GroupPathValue;
    if (type === 'timestamp' || type === 'timestamp without time zone') {
        return formatNaiveTimestamp(value);
    }
    return value.toISOString();
}

function getSummaryValue(
    plan: Pick<GroupedLevelQuery, 'summaries' | 'summaryTypes' | 'internalPrefix'>,
    row: Record<string, unknown>,
    summary: GroupSummaryOption,
    index: number,
    prefix = 'summary'
) {
    const type = plan.summaryTypes[index];
    const field = internalField(plan.internalPrefix, `${prefix}_${index}`);
    if (['count', 'countEmpty', 'countDistinct'].includes(summary.operation)) return toNumber(row[field]);
    if (summary.operation !== 'range') return formatTypedValue(row[field], type);
    return {
        lower: formatTypedValue(row[`${field}_lower`], type),
        upper: formatTypedValue(row[`${field}_upper`], type),
    };
}

function getSummaryValues(
    plan: Pick<GroupedLevelQuery, 'summaries' | 'summaryTypes' | 'internalPrefix'>,
    row: Record<string, unknown>,
    prefix = 'summary'
) {
    return Object.fromEntries(
        plan.summaries.map((summary, index) => [summary.id, getSummaryValue(plan, row, summary, index, prefix)])
    );
}

function getSummaryInternalFields(plan: GroupedLevelQuery, prefix: string) {
    return plan.summaries.flatMap((summary, index) => {
        const field = internalField(plan.internalPrefix, `${prefix}_${index}`);
        return summary.operation === 'range' ? [`${field}_lower`, `${field}_upper`] : [field];
    });
}

type HydratedNode = {
    depth?: unknown;
    path?: unknown;
    value?: unknown;
    count?: unknown;
    summaries?: unknown;
    rows?: unknown;
    rowsHasMore?: unknown;
    rowCursorValues?: unknown;
};

function formatHydratedSummaries(plan: GroupedLevelQuery, value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object') return {};
    const summaries = value as Record<string, unknown>;
    return Object.fromEntries(
        plan.summaries.map((summary, index) => {
            const raw = summaries[summary.id];
            if (summary.operation === 'range' && raw && typeof raw === 'object') {
                const range = raw as { lower: unknown; upper: unknown };
                return [
                    summary.id,
                    {
                        lower: formatTypedValue(range.lower, plan.summaryTypes[index]),
                        upper: formatTypedValue(range.upper, plan.summaryTypes[index]),
                    },
                ];
            }
            if (['count', 'countEmpty', 'countDistinct'].includes(summary.operation))
                return [summary.id, toNumber(raw)];
            return [summary.id, formatTypedValue(raw, plan.summaryTypes[index])];
        })
    );
}

type FormattedGroupNode = {
    id: string;
    depth: number;
    key: string;
    value: GroupPathValue;
    pathValue: GroupPathValue;
    label: string;
    count: number;
    summaries: Record<string, unknown>;
    hasChildren: boolean;
    childrenPageInfo: {
        hasMore: boolean;
        nextCursor: string | null;
        startCursor: string;
        limit?: number;
        offset?: number;
        total?: number;
    };
    children?: FormattedGroupNode[];
    rows?: Record<string, unknown>[];
};

function getChildrenPageInfo(plan: GroupedLevelQuery, path: GroupPathValue[], total: number) {
    const isLeaf = path.length === plan.groupBy.length;
    const startCursor = encodeCursor({
        kind: isLeaf ? 'row' : 'group',
        depth: path.length,
        path,
        start: true,
    });
    return {
        hasMore: true,
        nextCursor: startCursor,
        startCursor,
        limit: isLeaf ? HYDRATED_ROW_LIMIT : plan.limit,
        offset: 0,
        ...(isLeaf ? { total } : {}),
    };
}

function attachHydratedNodes(plan: GroupedLevelQuery, raw: Record<string, unknown>, groups: FormattedGroupNode[]) {
    if (!plan.hydrated) return;
    const field = internalField(plan.internalPrefix, 'hydrated_nodes');
    const nodes = Array.isArray(raw[field]) ? (raw[field] as HydratedNode[]) : [];
    const byPath = new Map<string, FormattedGroupNode>();
    let hydratedRowsBytes = 0;
    for (const group of groups) byPath.set(JSON.stringify([group.pathValue]), group);

    for (const rawNode of nodes) {
        if (!Number.isInteger(rawNode.depth) || !Array.isArray(rawNode.path)) continue;
        const depth = rawNode.depth as number;
        const path = rawNode.path as GroupPathValue[];
        if (path.length !== depth + 1 || depth >= plan.groupBy.length) continue;
        const pathKey = JSON.stringify(path);
        let node = byPath.get(pathKey);
        if (!node) {
            const parent = byPath.get(JSON.stringify(path.slice(0, -1)));
            if (!parent) continue;
            const value = formatGroupValue({ ...plan, depth }, rawNode.value);
            node = {
                id: getNodeId(path),
                depth,
                key: plan.groupBy[depth].field.join('.'),
                value,
                pathValue: path.at(-1),
                label: getLabel(value),
                count: toNumber(rawNode.count),
                summaries: formatHydratedSummaries(plan, rawNode.summaries),
                hasChildren: true,
                children: [],
                childrenPageInfo: getChildrenPageInfo(plan, path, toNumber(rawNode.count)),
            };
            const children = parent.children || [];
            children.push(node);
            parent.children = children;
            byPath.set(pathKey, node);
        }

        if (depth !== plan.groupBy.length - 1 || !Array.isArray(rawNode.rows)) continue;
        const rows = rawNode.rows as Record<string, unknown>[];
        const rowsBytes = Buffer.byteLength(JSON.stringify(rows));
        if (hydratedRowsBytes + rowsBytes > MAX_HYDRATED_ROWS_BYTES) continue;
        hydratedRowsBytes += rowsBytes;
        const hasMore = rawNode.rowsHasMore === true;
        const cursorValues = rawNode.rowCursorValues;
        node.rows = rows;
        node.childrenPageInfo = {
            ...getChildrenPageInfo(plan, path, node.count),
            hasMore,
            nextCursor:
                hasMore && Array.isArray(cursorValues)
                    ? encodeCursor({
                          kind: 'row',
                          depth: path.length,
                          path,
                          values: cursorValues as GroupPathValue[],
                          offset: rows.length,
                      })
                    : null,
        };
    }

    const totals = raw[internalField(plan.internalPrefix, 'child_totals')];
    const childTotals = new Map<string, number>();
    if (totals && typeof totals === 'object') {
        for (const [path, total] of Object.entries(totals))
            childTotals.set(JSON.stringify(JSON.parse(path)), toNumber(total));
    }
    for (const [path, node] of byPath) {
        if (node.depth === plan.groupBy.length - 1) continue;
        const total = childTotals.get(path);
        if (total === undefined) continue;
        const hasMore = (node.children?.length || 0) < total;
        node.childrenPageInfo = {
            ...node.childrenPageInfo,
            limit: plan.limit,
            offset: 0,
            total,
            hasMore,
            // Hydration can overlap the first child page; callers merge nodes by ID.
            nextCursor: hasMore ? node.childrenPageInfo.startCursor : null,
        };
    }
}

export function formatSummaryResponse(plan: SummaryQuery, rawResult: unknown) {
    const rawRows = Array.isArray(rawResult) ? rawResult : [];
    const raw = rawRows[0] && typeof rawRows[0] === 'object' ? (rawRows[0] as Record<string, unknown>) : {};
    return getSummaryValues(plan, raw);
}

export function removeGroupedHiddenFields(rows: Record<string, unknown>[], hiddenFields: string[] = []) {
    if (!hiddenFields.length) return rows;
    const hiddenFieldSet = new Set(hiddenFields);
    return rows.map(row => Object.fromEntries(Object.entries(row).filter(([field]) => !hiddenFieldSet.has(field))));
}

export function formatGroupedResponse(
    plan: GroupedLevelQuery,
    rawResult: unknown,
    { preserveHiddenFields = false }: { preserveHiddenFields?: boolean } = {}
) {
    const rawRows = Array.isArray(rawResult) ? rawResult : [];
    const raw = rawRows[0] && typeof rawRows[0] === 'object' ? (rawRows[0] as Record<string, unknown>) : {};
    const hasItemField = internalField(plan.internalPrefix, 'has_item');
    const rowOrderField = internalField(plan.internalPrefix, 'row_order');
    const rootTotalField = internalField(plan.internalPrefix, 'root_total');
    const totalRowsField = internalField(plan.internalPrefix, 'total_rows');
    const levelTotalField = internalField(plan.internalPrefix, 'level_total');
    const hasMoreField = internalField(plan.internalPrefix, 'has_more');
    const nextOffsetField = internalField(plan.internalPrefix, 'next_offset');
    const pathValueField = internalField(plan.internalPrefix, 'path_value');
    const rootTotal = toNumber(raw[rootTotalField]);
    const totalRows = toNumber(raw[totalRowsField]);
    const levelTotal = toNumber(raw[levelTotalField]);
    const globalSummaries = getSummaryValues(plan, raw, 'global_summary');

    if (plan.kind === 'rows') {
        const internalFields = new Set([
            hasItemField,
            rowOrderField,
            rootTotalField,
            totalRowsField,
            levelTotalField,
            hasMoreField,
            nextOffsetField,
            ...plan.groupBy.map((_, index) => internalField(plan.internalPrefix, `group_${index}`)),
            ...getSummaryInternalFields(plan, 'global_summary'),
            ...(!preserveHiddenFields ? plan.hiddenFields || [] : []),
        ]);
        const pageRows = rawRows
            .filter(row => row && typeof row === 'object' && (row as Record<string, unknown>)[hasItemField] === true)
            .slice(0, plan.limit) as Record<string, unknown>[];
        const rows = pageRows.map(row =>
            Object.fromEntries(
                Object.entries(row as Record<string, unknown>).filter(([field]) => !internalFields.has(field))
            )
        );
        const hasMore = raw[hasMoreField] === true;
        const nextOffset = hasMore ? toNumber(raw[nextOffsetField]) : null;
        const lastRow = pageRows.at(-1);
        const nextCursor =
            hasMore && lastRow
                ? encodeCursor({
                      kind: 'row',
                      depth: plan.depth,
                      path: plan.path,
                      offset: plan.offset + rows.length,
                      values: plan.rowOrder.map((item, index) =>
                          formatTypedValue(lastRow[item.field], plan.rowOrderTypes[index])
                      ) as GroupPathValue[],
                  })
                : null;
        return {
            kind: 'rows' as const,
            rows,
            metadata: {
                depth: plan.depth,
                path: plan.path,
                limit: plan.limit,
                offset: plan.offset,
                nextOffset,
                nextCursor,
                hasMore,
                total: rootTotal,
                totalRows,
                levelTotal,
                summaries: globalSummaries,
            },
        };
    }

    const groupRows = rawRows
        .filter(row => row && typeof row === 'object' && (row as Record<string, unknown>)[hasItemField] === true)
        .slice(0, plan.limit) as Record<string, unknown>[];
    const groups: FormattedGroupNode[] = groupRows.map(rawGroup => {
        const group = rawGroup as Record<string, unknown>;
        const value = formatGroupValue(plan, group.value);
        const pathValue = (Object.hasOwn(group, pathValueField) ? group[pathValueField] : value) as GroupPathValue;
        const path = [...plan.path, pathValue];
        const summaries = getSummaryValues(plan, group);
        return {
            id: getNodeId(path),
            depth: plan.depth,
            key: plan.groupBy[plan.depth].field.join('.'),
            value,
            pathValue,
            label: getLabel(value),
            count: toNumber(group.count),
            summaries,
            hasChildren: true,
            childrenPageInfo: getChildrenPageInfo(plan, path, toNumber(group.count)),
        };
    });
    attachHydratedNodes(plan, raw, groups);
    const hasMore =
        rawRows.filter(row => row && typeof row === 'object' && (row as Record<string, unknown>)[hasItemField] === true)
            .length > plan.limit;
    const nextOffset = hasMore ? plan.offset + groups.length : null;
    const nextCursor =
        nextOffset !== null && groups.length
            ? encodeCursor({
                  kind: 'group',
                  depth: plan.depth,
                  path: plan.path,
                  value: groups.at(-1)!.pathValue,
                  offset: nextOffset,
              })
            : null;
    return {
        kind: 'groups' as const,
        groups,
        metadata: {
            depth: plan.depth,
            path: plan.path,
            limit: plan.limit,
            offset: plan.offset,
            nextOffset,
            nextCursor,
            hasMore,
            total: rootTotal,
            totalRows,
            levelTotal,
            summaries: globalSummaries,
        },
    };
}
