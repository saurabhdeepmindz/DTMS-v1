import { createHash, randomUUID } from 'node:crypto';
import { getFormulaEnvironmentNames, getFormulaEnvValues, type RuntimeEnv } from '../env.service.ts';
import { parseSchema, parseTableFormulaColumns } from '../../schemas/tableFormulaColumns.ts';
import { isPlainObject } from '../../utils/objectGuards.ts';
import FORMULA_ENVIRONMENT_NAMES from '../../data/formulaEnvironmentNames.json' with { type: 'json' };
import { FormulaQueryPlanningError, FormulaUnavailableError } from './formulaExecutionErrors.ts';
import {
    isInactiveFilter,
    type Filter,
    type FormulaQueryInputs,
    type FormulaSqlCall,
    type IncludeConfig,
    type SelectColumns,
    type SortOption,
} from './queryBuilder.ts';

type PrepareFormulaV2Options = {
    schema?: string;
    table: string;
    columns?: unknown;
    filters?: Filter;
    sort?: SortOption[];
    includes?: IncludeConfig[];
    tableFormulaColumns: unknown;
    env?: string;
    auth?: { user?: unknown; isAuthenticated?: boolean };
    parameters?: Record<string, unknown>;
    timestamp?: Date;
    randomSeed?: string;
};

function unwrapColumn(value: unknown) {
    if (isPlainObject(value) && Object.hasOwn(value, '$value')) return value.$value;
    return value;
}

function getSelectedNames(columns: unknown, availableNames: Set<string>, { selectAll = true } = {}) {
    const selected = new Set<string>();
    const value = unwrapColumn(columns);
    const allSelected =
        value === '*' ||
        value === true ||
        value === undefined ||
        value === null ||
        (Array.isArray(value) && value.length === 0) ||
        (isPlainObject(value) && value['*'] === true);
    if (allSelected && selectAll) {
        for (const name of availableNames) selected.add(name);
    }
    if (Array.isArray(value)) {
        for (const name of value) if (typeof name === 'string' && availableNames.has(name)) selected.add(name);
    }
    if (isPlainObject(value)) {
        if (value.$mode === 'array' && typeof value.field === 'string' && availableNames.has(value.field)) {
            selected.add(value.field);
        }
        for (const [name, node] of Object.entries(value)) {
            if (name.startsWith('$') || !availableNames.has(name)) continue;
            const actualValue = unwrapColumn(node);
            if (actualValue === true || actualValue === '*' || isPlainObject(actualValue)) selected.add(name);
        }
    }
    return selected;
}

function removeFormulaNamesFromColumns(columns: unknown, formulaNames: Set<string>) {
    if (columns === '*' || columns === undefined || columns === null) return { '*': true };
    if (Array.isArray(columns)) {
        return Object.fromEntries(
            columns.filter(name => typeof name === 'string' && !formulaNames.has(name)).map(name => [name, true])
        );
    }
    if (!isPlainObject(columns)) return {};
    const result = { ...columns };
    for (const name of formulaNames) delete result[name];
    return result;
}

function getColumnSelection(columns: unknown, name: string) {
    const value = unwrapColumn(columns);
    if (isPlainObject(value) && Object.hasOwn(value, name)) return value[name];
    return true;
}

function assertAvailableFormulas(
    columns: Array<{ name: string; compiledArtifact?: unknown; transferErrorCode?: string | null }>,
    requiredNames: Set<string>
) {
    const unavailable = columns.filter(column => requiredNames.has(column.name) && !column.compiledArtifact);
    if (unavailable.length) throw new FormulaUnavailableError(unavailable);
}

function collectFilterNames(filter: Filter | undefined, availableNames: Set<string>, result: Set<string>) {
    if (!filter || isInactiveFilter(filter)) return;
    if ('conditions' in filter && Array.isArray(filter.conditions)) {
        for (const condition of filter.conditions) collectFilterNames(condition, availableNames, result);
        return;
    }
    if (!('field' in filter)) return;
    const path = Array.isArray(filter.field) ? filter.field : [filter.field];
    if (path.length === 1 && !filter.alias && path[0] && availableNames.has(path[0])) result.add(path[0]);
}

function collectSortNames(sort: SortOption[] | undefined, availableNames: Set<string>, result: Set<string>) {
    for (const item of sort || []) {
        const path = Array.isArray(item.field) ? item.field : item.field ? [item.field] : item.key ? [item.key] : [];
        if (path.length === 1 && !item.alias && path[0] && availableNames.has(path[0])) result.add(path[0]);
    }
}

function getColumnsAtPath(columns: unknown, path: string[]) {
    let current = unwrapColumn(columns);
    for (const segment of path) {
        if (!isPlainObject(current) || !Object.hasOwn(current, segment)) return undefined;
        current = unwrapColumn(current[segment]);
    }
    return current;
}

function collectScopedFilterNames(
    filter: Filter | undefined,
    scopeAlias: string,
    availableNames: Set<string>,
    result: Set<string>
) {
    if (!filter || isInactiveFilter(filter)) return;
    if ('conditions' in filter && Array.isArray(filter.conditions)) {
        for (const condition of filter.conditions) {
            collectScopedFilterNames(condition, scopeAlias, availableNames, result);
        }
        return;
    }
    if (!('field' in filter)) return;
    const path = Array.isArray(filter.field) ? filter.field : [filter.field];
    const alias = path.length > 1 ? path.slice(0, -1).join('.') : filter.alias;
    const name = path[path.length - 1];
    if (alias === scopeAlias && name && availableNames.has(name)) result.add(name);
}

function collectScopedSortNames(
    sort: SortOption[] | undefined,
    scopeAlias: string,
    availableNames: Set<string>,
    result: Set<string>
) {
    for (const item of sort || []) {
        const path = Array.isArray(item.field) ? item.field : item.field ? [item.field] : item.key ? [item.key] : [];
        const alias = path.length > 1 ? path.slice(0, -1).join('.') : item.alias;
        const name = path[path.length - 1];
        if (alias === scopeAlias && name && availableNames.has(name)) result.add(name);
    }
}

function getIncludeScopeAlias(include: IncludeConfig) {
    return include.alias || include.path?.join('.');
}

function getIncludeParentAlias(include: IncludeConfig) {
    if (include.fromAlias !== undefined) return include.fromAlias;
    return include.path && include.path.length > 1 ? include.path.slice(0, -1).join('.') : null;
}

function isInManyIncludeTree(include: IncludeConfig, includesByAlias: Map<string, IncludeConfig>) {
    const visited = new Set<IncludeConfig>();
    let current: IncludeConfig | undefined = include;
    while (current && !visited.has(current)) {
        if (current.many) return true;
        visited.add(current);
        const parentAlias = getIncludeParentAlias(current);
        current = parentAlias ? includesByAlias.get(parentAlias) : undefined;
    }
    return false;
}

function normalizeRuntimeEnv(env?: string): RuntimeEnv {
    return env === 'editor' || env === 'staging' || env === 'production' ? env : 'current';
}

function quoteIdentifier(value: string) {
    return `"${value.replaceAll('"', '""')}"`;
}

function expectedSqlName(
    formulaId: string,
    schema: string,
    table: string,
    resultType: { postgresType: string },
    inputAbiVersion: 1 | 2
) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(formulaId)) {
        throw new Error('Formula V2 has an invalid identity');
    }
    const signatureTypes = [
        `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`,
        ...(inputAbiVersion === 2 ? ['jsonb'] : []),
        'jsonb',
        'jsonb',
        'boolean',
        'timestamp with time zone',
        'text',
    ];
    const interfaceRevision = createHash('sha256')
        .update([...signatureTypes, resultType.postgresType].join('|'))
        .digest('hex')
        .slice(0, 8);
    return `f_${formulaId.replaceAll('-', '').toLowerCase()}_${interfaceRevision}`;
}

function assertTrustedArtifactIdentity(
    formulaId: string,
    schema: string,
    table: string,
    artifact: { sqlSchema: string; sqlName: string; resultType: { postgresType: string } }
): 1 | 2 {
    if (artifact.sqlSchema === 'ww_formula') {
        for (const inputAbiVersion of [2, 1] as const) {
            if (artifact.sqlName === expectedSqlName(formulaId, schema, table, artifact.resultType, inputAbiVersion)) {
                return inputAbiVersion;
            }
        }
    }
    throw new Error('Formula V2 artifact identity does not match its formula');
}

export function prepareFormulaV2Query(options: PrepareFormulaV2Options): {
    columns: SelectColumns | undefined;
    calls: FormulaSqlCall[];
    inputs: FormulaQueryInputs;
} {
    const schema = parseSchema(options.schema);
    const catalog = parseTableFormulaColumns(options.tableFormulaColumns);
    const tableFormulas = catalog.filter(
        column =>
            column.engineVersion === 2 && parseSchema(column.schema) === schema && column.tableName === options.table
    );
    const unavailableNames = new Set(tableFormulas.filter(column => !column.compiledArtifact).map(column => column.name));
    const requiredUnavailableNames = getSelectedNames(options.columns, unavailableNames, { selectAll: false });
    collectFilterNames(options.filters, unavailableNames, requiredUnavailableNames);
    collectSortNames(options.sort, unavailableNames, requiredUnavailableNames);
    assertAvailableFormulas(tableFormulas, requiredUnavailableNames);

    const formulas = tableFormulas.filter(column => column.compiledArtifact);
    const byName = new Map(formulas.map(column => [column.name, column]));
    const requiredNames = getSelectedNames(options.columns, new Set(byName.keys()));
    collectFilterNames(options.filters, new Set(byName.keys()), requiredNames);
    collectSortNames(options.sort, new Set(byName.keys()), requiredNames);

    const calls: FormulaSqlCall[] = [];
    const requiredEnvironmentNames = new Set<string>();
    const runtimeEnv = normalizeRuntimeEnv(options.env);
    const allowedEnvironmentNames = getFormulaEnvironmentNames(FORMULA_ENVIRONMENT_NAMES);
    const appendCall = (column: (typeof formulas)[number] | undefined, scopeAlias?: string) => {
        const artifact = column?.compiledArtifact;
        if (!column || !artifact) return;
        const inputAbiVersion = assertTrustedArtifactIdentity(
            column.id,
            parseSchema(column.schema),
            column.tableName,
            artifact
        );
        calls.push({
            formulaId: column.id,
            field: column.name,
            ...(scopeAlias ? { scopeAlias } : {}),
            artifactHash: artifact.graphHash,
            sqlSchema: artifact.sqlSchema,
            sqlName: artifact.sqlName,
            ...(artifact.previewVersion === 1 ? { previewVersion: 1 as const } : {}),
            inputAbiVersion,
            resultType: artifact.resultType,
        });
        for (const input of artifact.inputTypes) {
            if (!input.name.startsWith('env.')) continue;
            requiredEnvironmentNames.add(input.name.slice(4));
        }
    };
    for (const name of [...requiredNames].sort()) appendCall(byName.get(name));

    const includes = options.includes || [];
    const includesByAlias = new Map(
        includes.flatMap(include => {
            const alias = getIncludeScopeAlias(include);
            return alias ? [[alias, include] as const] : [];
        })
    );
    for (const include of includes) {
        const scopeAlias = getIncludeScopeAlias(include);
        if (!scopeAlias) continue;
        const includeSchema = parseSchema(include.schema);
        const includeCatalog = catalog.filter(
            column =>
                column.engineVersion === 2 &&
                parseSchema(column.schema) === includeSchema &&
                column.tableName === include.table
        );
        if (isInManyIncludeTree(include, includesByAlias)) {
            const includeFormulaNames = new Set(includeCatalog.map(column => column.name));
            const unsupportedNames = new Set<string>();
            collectScopedFilterNames(options.filters, scopeAlias, includeFormulaNames, unsupportedNames);
            collectScopedSortNames(options.sort, scopeAlias, includeFormulaNames, unsupportedNames);
            if (unsupportedNames.size) {
                throw new FormulaQueryPlanningError(scopeAlias, [...unsupportedNames]);
            }
        }
        const unavailableIncludeNames = new Set(
            includeCatalog.filter(column => !column.compiledArtifact).map(column => column.name)
        );
        const scopeColumns = getColumnsAtPath(options.columns, scopeAlias.split('.'));
        const requiredUnavailableIncludeNames =
            scopeColumns === undefined
                ? new Set<string>()
                : getSelectedNames(scopeColumns, unavailableIncludeNames, { selectAll: false });
        collectScopedFilterNames(options.filters, scopeAlias, unavailableIncludeNames, requiredUnavailableIncludeNames);
        collectScopedSortNames(options.sort, scopeAlias, unavailableIncludeNames, requiredUnavailableIncludeNames);
        collectFilterNames(include.filters, unavailableIncludeNames, requiredUnavailableIncludeNames);
        collectSortNames(include.sort, unavailableIncludeNames, requiredUnavailableIncludeNames);
        assertAvailableFormulas(includeCatalog, requiredUnavailableIncludeNames);

        const includeFormulas = includeCatalog
            .filter(column => column.compiledArtifact)
            .sort((left, right) => left.name.localeCompare(right.name));
        const availableNames = new Set(includeFormulas.map(column => column.name));
        const requiredIncludeNames =
            scopeColumns === undefined ? new Set<string>() : getSelectedNames(scopeColumns, availableNames);
        collectScopedFilterNames(options.filters, scopeAlias, availableNames, requiredIncludeNames);
        collectScopedSortNames(options.sort, scopeAlias, availableNames, requiredIncludeNames);
        collectFilterNames(include.filters, availableNames, requiredIncludeNames);
        collectSortNames(include.sort, availableNames, requiredIncludeNames);
        for (const column of includeFormulas) {
            if (requiredIncludeNames.has(column.name)) appendCall(column, scopeAlias);
        }
    }

    const selectedNames = getSelectedNames(options.columns, new Set(byName.keys()));
    const baseColumns = removeFormulaNamesFromColumns(
        options.columns,
        new Set(tableFormulas.map(column => column.name))
    );
    for (const name of selectedNames) baseColumns[name] = getColumnSelection(options.columns, name);

    return {
        columns: baseColumns as SelectColumns,
        calls,
        inputs: {
            parameters: options.parameters || {},
            env: getFormulaEnvValues(requiredEnvironmentNames, allowedEnvironmentNames, runtimeEnv),
            authUser: options.auth?.user,
            isAuthenticated: options.auth?.isAuthenticated === true,
            timestamp: (options.timestamp || new Date()).toISOString(),
            randomSeed: options.randomSeed || randomUUID(),
        },
    };
}

export function getFormulaMutationTargets(
    data: Record<string, unknown> | Array<Record<string, unknown>>,
    tableFormulaColumns: unknown,
    { schema = 'public', table }: { schema?: string; table: string }
) {
    const formulaNames = new Set(
        parseTableFormulaColumns(tableFormulaColumns)
            .filter(column => parseSchema(column.schema) === parseSchema(schema) && column.tableName === table)
            .map(column => column.name)
    );
    const rows = Array.isArray(data) ? data : [data];
    const targets = new Set<string>();
    for (const row of rows) {
        for (const name of Object.keys(row || {})) if (formulaNames.has(name)) targets.add(name);
    }
    return [...targets].sort();
}
