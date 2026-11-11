import { isFormulaBindingValue } from '../../schemas/formulas.ts';
import { parseSchema, parseTableFormulaColumns, type TableFormulaColumn } from '../../schemas/tableFormulaColumns.ts';
import { isPlainObject } from '../../utils/objectGuards.ts';
import { extractSelectionValue, selectFormulaColumns } from './formulaColumnSelection.ts';

type Scope = {
    schema?: string;
    table?: string;
};

type IncludeScope = Scope & {
    path?: string[];
    alias?: string;
};

type TableViewFormulaColumnsScope = Scope & {
    includes?: IncludeScope[];
    columns?: unknown;
};

function getTableFormulaColumnsConfig(tableFormulaColumns: unknown, scope: Scope) {
    const result: Record<string, unknown> = {};
    const schema = parseSchema(scope.schema);
    if (!scope.table) return result;

    for (const column of parseTableFormulaColumns(tableFormulaColumns)) {
        if (column.tableName !== scope.table || parseSchema(column.schema) !== schema) continue;
        if (column.engineVersion === 2 || !column.formula) continue;
        result[column.name] = column.formula;
    }

    return result;
}

function getIncludePath(include: IncludeScope) {
    if (Array.isArray(include.path)) return include.path;
    if (include.alias) return [include.alias];
    return [];
}

function getIncludeMap(includes: IncludeScope[] = []) {
    const includeMap = new Map<string, IncludeScope>();
    for (const include of includes) {
        const path = getIncludePath(include);
        if (!path.length) continue;
        includeMap.set(path.join('.'), include);
    }
    return includeMap;
}

function getFormulaColumnRelationPaths(columns: unknown, includeMap: Map<string, IncludeScope>, parentPath: string[] = []): string[][] {
    const value = extractSelectionValue(columns);
    if (!isPlainObject(value) || isFormulaBindingValue(value)) return [];

    const paths: string[][] = [];
    for (const [key, rawValue] of Object.entries(value)) {
        if (key.startsWith('$')) continue;
        const currentPath = [...parentPath, key];
        const pathKey = currentPath.join('.');
        const actualValue = extractSelectionValue(rawValue);
        if (includeMap.has(pathKey)) paths.push(currentPath);
        paths.push(...getFormulaColumnRelationPaths(actualValue, includeMap, currentPath));
    }

    return paths;
}

function setNestedFormulaColumnsConfig(config: Record<string, unknown>, path: string[], formulaColumnsConfig: Record<string, unknown>) {
    if (!path.length || !Object.keys(formulaColumnsConfig).length) return;

    let current = config;
    for (const segment of path) {
        if (!current[segment] || typeof current[segment] !== 'object' || Array.isArray(current[segment])) {
            current[segment] = {};
        }
        current = current[segment] as Record<string, unknown>;
    }

    Object.assign(current, formulaColumnsConfig);
}

function getTableViewFormulaColumnsConfig(tableFormulaColumns: unknown, scope: TableViewFormulaColumnsScope) {
    const result = getTableFormulaColumnsConfig(tableFormulaColumns, scope);
    const includeMap = getIncludeMap(scope.includes);

    for (const path of getFormulaColumnRelationPaths(scope.columns, includeMap)) {
        const include = includeMap.get(path.join('.'));
        if (!include) continue;
        const includeFormulaColumnsConfig = getTableFormulaColumnsConfig(tableFormulaColumns, {
            schema: include.schema,
            table: include.table,
        });
        setNestedFormulaColumnsConfig(result, path, includeFormulaColumnsConfig);
    }

    return selectFormulaColumns(scope.columns, result);
}

export { getTableFormulaColumnsConfig, getTableViewFormulaColumnsConfig };
