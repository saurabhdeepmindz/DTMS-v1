import type { IncludeConfig } from './queryBuilder.ts';
import { isFormulaBindingValue, type FormulaBinding } from '../../schemas/formulas.ts';
import { isFormulaBinding } from '../tmp/formulas/utils.js';
import { getValue } from '../tmp/utils/input.js';
import { isPlainObject } from '../../utils/objectGuards.ts';
import { selectFormulaColumns } from './formulaColumnSelection.ts';

type FormulaColumnsConfig = {
    [key: string]: FormulaBinding | FormulaColumnsConfig;
};

type ColumnModeArray = {
    $mode: 'array';
    field: string;
};

type ColumnNode = true | '*' | ColumnModeArray | FormulaBinding | AliasedColumn | ColumnMap;

type ColumnMap = {
    '*'?: true;
    [key: string]: ColumnNode | true | undefined;
};

type AliasedColumn = {
    $alias: string;
    $value: ColumnNode;
};

type Scope = {
    schema?: string;
    table?: string;
};

type PrepareFormulaColumnsOptions = Scope & {
    includes?: IncludeConfig[];
};

type PreparedFormulaColumns = {
    hasFormulaColumns: boolean;
    materializedColumns: unknown;
    normalizedColumns: unknown;
};

type FormulaExecutionContext = Record<string, unknown>;

type MaterializedFormulaField = {
    field: string;
    scopeAlias?: string;
};

function isAliasedColumn(value: unknown): value is AliasedColumn {
    return isPlainObject(value) && Object.hasOwn(value, '$alias') && Object.hasOwn(value, '$value');
}

export function getLegacyFormulaColumnsConfig(value: unknown): unknown {
    if (!isPlainObject(value)) return value;
    if (isFormulaBindingValue(value)) {
        return value.__wwFormulaEngineVersion === 2 ? undefined : value;
    }

    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
        const legacyEntry = getLegacyFormulaColumnsConfig(entry);
        if (legacyEntry !== undefined) result[key] = legacyEntry;
    }
    return result;
}

function isArrayMode(value: unknown): value is ColumnModeArray {
    return isPlainObject(value) && value.$mode === 'array';
}

function extractAliasAndValue(value: unknown): { alias: string | null; actualValue: unknown } {
    if (isAliasedColumn(value)) {
        return { alias: value.$alias, actualValue: value.$value };
    }

    return { alias: null, actualValue: value };
}

function isFormulaFieldPublicFileUrlColumn(key: string, actualValue: unknown, scope: Scope) {
    return key === 'url' && actualValue === true && scope?.schema === 'storage' && scope?.table === 'publicFiles';
}

function createFormulaFieldPublicFileUrlColumn(): FormulaBinding {
    return {
        __wwtype: 'f',
        code: "wwFormulas.getStorageUrl(context.row.path, 'public')",
        // Injected by us, not asked for: a provider that cannot build a public URL must cost this
        // column, not the whole query. Callers already treat `url` as nullable.
        __wwNullOnError: true,
    };
}

function getFormulaFieldColumnsForScope(scope: Scope): ColumnMap {
    if (scope?.schema === 'storage' && scope?.table === 'publicFiles') {
        return {
            url: createFormulaFieldPublicFileUrlColumn(),
        };
    }

    return {};
}

function createAllColumnsNodeForScope(scope: Scope): ColumnNode {
    const formulaFieldColumns = getFormulaFieldColumnsForScope(scope);

    if (!Object.keys(formulaFieldColumns).length) {
        return '*';
    }

    return {
        '*': true,
        ...formulaFieldColumns,
    };
}

function cloneValue<T>(value: T): T {
    if (Array.isArray(value)) {
        return value.map(entry => cloneValue(entry)) as T;
    }

    if (!isPlainObject(value)) {
        return value;
    }

    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
        result[key] = cloneValue(entry);
    }
    return result as T;
}

function normalizeColumnsForScope(
    columns: unknown,
    scope: Scope,
    includeMap: Map<string, Scope>,
    path: string[] = []
): unknown {
    if (columns === '*') {
        return createAllColumnsNodeForScope(scope);
    }

    if (!isPlainObject(columns) || isArrayMode(columns)) {
        return columns;
    }

    const result: ColumnMap = {};

    for (const [key, rawValue] of Object.entries(columns)) {
        const { alias, actualValue } = extractAliasAndValue(rawValue);
        const nextPath = [...path, key];
        let nextValue = actualValue;

        if (isFormulaFieldPublicFileUrlColumn(key, actualValue, scope)) {
            nextValue = createFormulaFieldPublicFileUrlColumn();
        } else if (actualValue === '*') {
            const nextScope = includeMap.get(nextPath.join('.')) || scope;
            nextValue = createAllColumnsNodeForScope(nextScope);
        } else if (isPlainObject(actualValue) && !isFormulaBindingValue(actualValue) && !isArrayMode(actualValue)) {
            const nextScope = includeMap.get(nextPath.join('.')) || scope;
            nextValue = normalizeColumnsForScope(actualValue, nextScope, includeMap, nextPath);
        }

        result[key] = alias ? { $alias: alias, $value: nextValue as ColumnNode } : (nextValue as ColumnNode);
    }

    return result;
}

function normalizeFormulaFieldColumns(columns: unknown, options: PrepareFormulaColumnsOptions = {}): unknown {
    const includeMap = new Map<string, Scope>();

    for (const include of options.includes || []) {
        const pathKey = include.path?.join('.') || include.alias;
        if (!pathKey) continue;

        includeMap.set(pathKey, {
            schema: include.schema || 'public',
            table: include.table,
        });
    }

    return normalizeColumnsForScope(
        columns,
        {
            schema: options.schema || 'public',
            table: options.table,
        },
        includeMap
    );
}

function createMergedContainer(value: unknown): ColumnMap {
    if (value === '*') {
        return { '*': true };
    }

    if (Array.isArray(value)) {
        return createConfigFromArray(value);
    }

    if (isPlainObject(value) && !isFormulaBindingValue(value)) {
        return cloneValue(value as ColumnMap);
    }

    return {};
}

function createConfigFromArray(value: unknown[]): ColumnMap {
    const config: ColumnMap = {};
    if (!value.length) config['*'] = true;
    for (const column of value) {
        if (typeof column === 'string') config[column] = true;
    }
    return config;
}

function mergeFormulaColumnsNode(columnValue: unknown, formulaValue: unknown): ColumnNode {
    if (isFormulaBindingValue(formulaValue)) {
        return cloneValue(formulaValue);
    }

    if (!isPlainObject(formulaValue)) {
        return cloneValue(columnValue as ColumnNode);
    }

    const { alias, actualValue } = extractAliasAndValue(columnValue);
    const mergedValue = createMergedContainer(actualValue);

    for (const [key, value] of Object.entries(formulaValue)) {
        mergedValue[key] = mergeFormulaColumnsNode(mergedValue[key], value);
    }

    return alias ? { $alias: alias, $value: mergedValue } : mergedValue;
}

function mergeFormulaColumnsIntoColumns(columns: unknown, formulaColumns: unknown): unknown {
    if (!isPlainObject(formulaColumns) || !Object.keys(formulaColumns).length) {
        return columns;
    }

    const baseConfig = Array.isArray(columns)
        ? createConfigFromArray(columns)
        : columns === '*' || !isPlainObject(columns)
          ? {}
          : cloneValue(columns as ColumnMap);

    for (const [key, value] of Object.entries(formulaColumns)) {
        baseConfig[key] = mergeFormulaColumnsNode(baseConfig[key], value);
    }

    if (columns === '*' || columns === undefined || columns === null) {
        baseConfig['*'] = true;
    }

    return baseConfig;
}

function hasFormulaColumns(value: unknown): boolean {
    if (!isPlainObject(value)) {
        return false;
    }

    if (isFormulaBindingValue(value)) {
        return true;
    }

    if (isAliasedColumn(value)) {
        return hasFormulaColumns(value.$value);
    }

    if (isArrayMode(value)) {
        return false;
    }

    for (const [key, entry] of Object.entries(value)) {
        if (key.startsWith('$')) continue;
        if (hasFormulaColumns(entry)) {
            return true;
        }
    }

    return false;
}

function buildMaterializedNode(node: unknown): unknown {
    const { alias, actualValue } = extractAliasAndValue(node);

    if (isFormulaBindingValue(actualValue)) {
        return undefined;
    }

    let materializedValue = actualValue;

    if (isPlainObject(actualValue) && !isArrayMode(actualValue)) {
        materializedValue = buildMaterializedObject(actualValue, hasFormulaColumns(actualValue));
    }

    if (alias) {
        return { $alias: alias, $value: materializedValue };
    }

    return materializedValue;
}

function buildMaterializedObject(columns: unknown, includeAllColumns = false): ColumnMap {
    const materialized: ColumnMap = includeAllColumns ? { '*': true } : {};

    for (const [key, value] of Object.entries(columns || {})) {
        if (key.startsWith('$') || key === '*') continue;

        const materializedValue = buildMaterializedNode(value);
        if (materializedValue !== undefined) {
            materialized[key] = materializedValue as ColumnNode;
        }
    }

    return materialized;
}

function pickValue(container: unknown, key: string, outputKey: string) {
    if (!isPlainObject(container) && !Array.isArray(container)) {
        return undefined;
    }

    if (outputKey !== key && Object.hasOwn(container, outputKey)) {
        return container[outputKey];
    }

    return container[key];
}

function evaluateFormulaColumn(
    formula: FormulaBinding,
    context: FormulaExecutionContext,
    row: unknown,
    path: string[]
) {
    try {
        return getValue(formula, {
            ...context,
            row,
        });
    } catch (error) {
        if (formula.__wwNullOnError === true) {
            console.warn(
                `Formula column "${path.join('.')}" resolved to null: ${error instanceof Error ? error.message : error}`
            );
            return null;
        }
        throw new Error(`Failed to evaluate formula column "${path.join('.')}"`, { cause: error });
    }
}

function getFormulaEvaluationRow(
    row: unknown,
    columns: unknown,
    sourcePath: string[],
    materializedFormulaFields: MaterializedFormulaField[]
) {
    if (!isPlainObject(row)) return row;
    const scopeAlias = sourcePath.join('.');
    const excludedFields = materializedFormulaFields.filter(field => (field.scopeAlias || '') === scopeAlias);
    if (!excludedFields.length) return row;

    const result = { ...row };
    for (const field of excludedFields) {
        delete result[field.field];
        if (!isPlainObject(columns) || !Object.hasOwn(columns, field.field)) continue;
        const { alias } = extractAliasAndValue(columns[field.field]);
        if (alias) delete result[alias];
    }
    return result;
}

function projectObject(
    columns: unknown,
    current: unknown,
    context: FormulaExecutionContext,
    path: string[] = [],
    materializedFormulaFields: MaterializedFormulaField[] = [],
    sourcePath: string[] = []
): unknown {
    if (columns === '*' || columns === true || !isPlainObject(columns) || isArrayMode(columns)) {
        return current;
    }

    const result: Record<string, unknown> = columns['*'] === true && isPlainObject(current) ? { ...current } : {};

    for (const [key, rawValue] of Object.entries(columns)) {
        if (key.startsWith('$') || key === '*') continue;

        const { alias, actualValue } = extractAliasAndValue(rawValue);
        const outputKey = alias || key;
        const sourceValue = pickValue(current, key, outputKey);
        const nextPath = [...path, outputKey];
        const nextSourcePath = [...sourcePath, key];

        if (isFormulaBindingValue(actualValue)) {
            result[outputKey] = evaluateFormulaColumn(
                actualValue,
                context,
                getFormulaEvaluationRow(current, columns, sourcePath, materializedFormulaFields),
                nextPath
            );
            continue;
        }

        if (actualValue === true || actualValue === '*' || isArrayMode(actualValue)) {
            result[outputKey] = sourceValue;
            continue;
        }

        if (Array.isArray(sourceValue)) {
            result[outputKey] = sourceValue.map(item =>
                projectObject(actualValue, item, context, nextPath, materializedFormulaFields, nextSourcePath)
            );
            continue;
        }

        if (sourceValue === null || sourceValue === undefined) {
            result[outputKey] = sourceValue;
            continue;
        }

        result[outputKey] = projectObject(
            actualValue,
            sourceValue,
            context,
            nextPath,
            materializedFormulaFields,
            nextSourcePath
        );
    }

    return result;
}

function applyFormulaColumns(
    rows: unknown,
    columns: unknown,
    context: FormulaExecutionContext,
    materializedFormulaFields: MaterializedFormulaField[] = []
): unknown {
    if (!Array.isArray(rows) || !hasFormulaColumns(columns)) {
        return rows;
    }

    return rows.map(row => projectObject(columns, row, context, [], materializedFormulaFields));
}

function prepareFormulaColumns(
    columns: unknown,
    formulaColumns: FormulaColumnsConfig | undefined,
    options: PrepareFormulaColumnsOptions = {}
): PreparedFormulaColumns {
    const selectedFormulaColumns = selectFormulaColumns(columns, formulaColumns);
    const normalizedColumns = mergeFormulaColumnsIntoColumns(
        normalizeFormulaFieldColumns(columns, options),
        selectedFormulaColumns
    );
    const formulaEnabled = hasFormulaColumns(normalizedColumns);

    if (!formulaEnabled || !isPlainObject(normalizedColumns)) {
        return {
            hasFormulaColumns: formulaEnabled,
            materializedColumns: normalizedColumns,
            normalizedColumns,
        };
    }

    return {
        hasFormulaColumns: true,
        materializedColumns: buildMaterializedObject(normalizedColumns, true),
        normalizedColumns,
    };
}

function resolveWorkflowColumns(rawColumns: unknown, context: FormulaExecutionContext): unknown {
    if (rawColumns === null || rawColumns === undefined) {
        return rawColumns;
    }

    if (isFormulaBinding(rawColumns)) {
        return getValue(rawColumns, context);
    }

    if (Array.isArray(rawColumns)) {
        return rawColumns.map(value => resolveWorkflowColumns(value, context));
    }

    if (!isPlainObject(rawColumns)) {
        return rawColumns;
    }

    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(rawColumns)) {
        result[key] = resolveWorkflowColumns(value, context);
    }

    return result;
}

function resolveWorkflowFormulaColumns(rawFormulaColumns: unknown): unknown {
    if (rawFormulaColumns === null || rawFormulaColumns === undefined) {
        return rawFormulaColumns;
    }

    if (isFormulaBindingValue(rawFormulaColumns)) {
        return rawFormulaColumns;
    }

    if (Array.isArray(rawFormulaColumns)) {
        return rawFormulaColumns.map(value => resolveWorkflowFormulaColumns(value));
    }

    if (!isPlainObject(rawFormulaColumns)) {
        return rawFormulaColumns;
    }

    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(rawFormulaColumns)) {
        result[key] = resolveWorkflowFormulaColumns(value);
    }

    return result;
}

export { applyFormulaColumns, prepareFormulaColumns, resolveWorkflowColumns, resolveWorkflowFormulaColumns };
