import type {
    SupabaseFilter,
    SupabaseFilterCondition,
    SupabaseFilterField,
    SupabaseFilterGroup,
    SupabaseFilterValue,
    SupabaseJoinTypes,
} from '../supabase.types.ts';
import { getFilterFieldPath, isFilterGroup } from './supabaseGuards.ts';
import { SupabaseColumns } from './supabaseColumns.ts';
import type { ResolvedSupabaseField } from './supabaseColumns.ts';

type OrGroupExpression = {
    expression: string;
    scope: string;
};
type SupabaseReferencedTableOptions = { referencedTable: string };
type SupabaseQueryMethodArg = SupabaseFilterValue | SupabaseReferencedTableOptions;
type ResolvedFilterOperation = {
    methodName: string;
    queryArgs: SupabaseQueryMethodArg[];
    postgrestOperator: string;
    postgrestValue: string;
};

export class SupabaseFilters {
    static readonly INVALID_OR_SCOPE_MESSAGE = 'OR filters must target fields from the same relation level.';

    private static readonly POSTGREST_OP_OVERRIDES: Record<string, string> = {
        contains: 'cs', containedBy: 'cd', overlaps: 'ov', textSearch: 'fts',
    };

    private readonly filter?: SupabaseFilter;

    constructor(filter?: SupabaseFilter) {
        this.filter = SupabaseFilters.normalizeFilter(filter);
    }

    withPrefix(prefix: string[]): SupabaseFilters {
        const path = prefix.filter((part): part is string => typeof part === 'string');
        if (!path.length || !this.filter) return new SupabaseFilters(this.filter);
        return new SupabaseFilters(SupabaseFilters.prefixFilter(this.filter, path));
    }

    fieldPaths(): string[][] {
        const paths: string[][] = [];
        this.walkConditions(this.filter, condition => {
            if (this.shouldIgnoreCondition(condition)) return;
            paths.push(getFilterFieldPath(condition.field));
        });
        return paths;
    }

    withJoinTypes(columns: SupabaseColumns, joinTypes: SupabaseJoinTypes = {}): SupabaseJoinTypes {
        const nextJoinTypes = { ...joinTypes };
        this.walkConditions(this.filter, condition => {
            if (SupabaseFilters.isNullEqualityCondition(condition)) return;

            for (const relationPath of columns.resolveField(condition.field).relationPaths) {
                nextJoinTypes[relationPath] = 'inner';
            }
        });
        return nextJoinTypes;
    }

    applyTo<TQuery extends object>(query: TQuery, columns: SupabaseColumns): TQuery {
        if (!isFilterGroup(this.filter) || !this.filter.conditions?.length) return query;

        if (this.filter.link === '$or') {
            return this.applyOrGroup(query, this.filter, columns);
        }

        for (const condition of this.filter.conditions) {
            if (isFilterGroup(condition)) {
                if (condition.link === '$or') {
                    query = this.applyOrGroup(query, condition, columns);
                } else {
                    query = new SupabaseFilters(condition).applyTo(query, columns);
                }
                continue;
            }

            query = this.applyCondition(query, condition, columns);
        }

        return query;
    }

    getValidationError(columns: SupabaseColumns): string | null {
        return this.getInvalidOrGroup(this.filter, columns) ? SupabaseFilters.INVALID_OR_SCOPE_MESSAGE : null;
    }

    private applyCondition<TQuery extends object>(
        query: TQuery,
        condition: SupabaseFilterCondition,
        columns: SupabaseColumns
    ): TQuery {
        const { operator, value } = condition;
        const column = columns.resolveField(condition.field).column;
        if (!column || !operator) return query;
        if (value === undefined || value === '') return query;
        if (condition.isEmptyIgnored && value === null) return query;

        const operation = SupabaseFilters.resolveFilterOperation(operator, value);
        if (!operation) return query;
        return SupabaseFilters.applyQueryMethod(query, operation.methodName, column, ...operation.queryArgs);
    }

    private applyOrGroup<TQuery extends object>(
        query: TQuery,
        group: SupabaseFilterGroup,
        columns: SupabaseColumns
    ): TQuery {
        const result = this.orGroupToPostgrest(group, columns);
        if (!result?.expression) return query;

        if (result.scope) {
            return SupabaseFilters.applyQueryMethod(query, 'or', result.expression, { referencedTable: result.scope });
        }

        return SupabaseFilters.applyQueryMethod(query, 'or', result.expression);
    }

    private conditionToPostgrest(
        c: SupabaseFilterCondition,
        columns: SupabaseColumns,
        scope = ''
    ): string | null {
        const { operator, value } = c;
        const resolvedField = columns.resolveField(c.field);
        const column = this.getPostgrestColumn(resolvedField, scope);
        if (!column || !operator || value === undefined || value === '') return null;
        if (c.isEmptyIgnored && value === null) return null;

        const operation = SupabaseFilters.resolveFilterOperation(operator, value);
        if (!operation) return null;
        return `${column}.${operation.postgrestOperator}.${operation.postgrestValue}`;
    }

    private groupToPostgrest(group: SupabaseFilterGroup, columns: SupabaseColumns, scope = ''): string {
        const parts = (group.conditions || [])
            .map(c => isFilterGroup(c) ? this.groupToPostgrest(c, columns, scope) : this.conditionToPostgrest(c, columns, scope))
            .filter((part): part is string => !!part);

        if (group.link === '$or') return parts.join(',');
        return parts.length > 1 ? `and(${parts.join(',')})` : parts[0] || '';
    }

    private orGroupToPostgrest(group: SupabaseFilterGroup, columns: SupabaseColumns): OrGroupExpression | null {
        const scope = this.resolveOrGroupScope(group, columns);
        if (scope === null) throw new Error(SupabaseFilters.INVALID_OR_SCOPE_MESSAGE);

        const expression = this.groupToPostgrest(group, columns, scope);
        return expression ? { expression, scope } : null;
    }

    private resolveOrGroupScope(group: SupabaseFilterGroup, columns: SupabaseColumns): string | null {
        const scopes = new Set<string>();

        this.walkConditions(group, condition => {
            if (this.shouldIgnoreCondition(condition)) return;
            scopes.add(columns.resolveField(condition.field).scope);
        });

        if (scopes.size > 1) return null;
        return scopes.values().next().value || '';
    }

    private getInvalidOrGroup(filter: SupabaseFilter | undefined, columns: SupabaseColumns): SupabaseFilterGroup | null {
        if (!isFilterGroup(filter)) return null;
        if (filter.link === '$or' && this.resolveOrGroupScope(filter, columns) === null) return filter;

        for (const condition of filter.conditions || []) {
            const invalidGroup = this.getInvalidOrGroup(condition, columns);
            if (invalidGroup) return invalidGroup;
        }

        return null;
    }

    private getPostgrestColumn(field: ResolvedSupabaseField, scope: string): string {
        if (!scope) return field.column;
        return field.scope === scope ? field.scopedColumn : field.column;
    }

    private shouldIgnoreCondition(condition: SupabaseFilterCondition): boolean {
        const { operator, value } = condition;
        if (!operator || value === undefined || value === '') return true;
        return !!condition.isEmptyIgnored && value === null;
    }

    private static isNullEqualityCondition(condition: SupabaseFilterCondition): boolean {
        if (condition.operator === '$eq:null') return true;
        return condition.operator === 'is' && condition.value === null;
    }

    private static normalizeFilter(filter?: SupabaseFilter): SupabaseFilter | undefined {
        if (!isFilterGroup(filter)) return filter;
        if (filter.if === false) return undefined;

        const conditions: SupabaseFilter[] = [];
        for (const condition of filter.conditions || []) {
            const normalizedCondition = SupabaseFilters.normalizeFilter(condition);
            if (normalizedCondition) conditions.push(normalizedCondition);
        }

        return { ...filter, conditions };
    }

    private static prefixFilter(filter: SupabaseFilter, prefix: string[]): SupabaseFilter {
        if (isFilterGroup(filter)) {
            const conditions: SupabaseFilter[] = [];
            for (const condition of filter.conditions || []) {
                conditions.push(SupabaseFilters.prefixFilter(condition, prefix));
            }

            return { ...filter, conditions };
        }

        return {
            ...filter,
            field: SupabaseFilters.prefixField(prefix, filter.field),
        } satisfies SupabaseFilterCondition;
    }

    private static prefixField(prefix: string[], field?: SupabaseFilterField): string[] {
        if (field === '') return [...prefix];
        return [...prefix, ...getFilterFieldPath(field)];
    }

    private walkConditions(filter: SupabaseFilter | undefined, handler: (condition: SupabaseFilterCondition) => void) {
        if (!isFilterGroup(filter)) return;

        for (const condition of filter.conditions || []) {
            if (isFilterGroup(condition)) {
                this.walkConditions(condition, handler);
                continue;
            }

            handler(condition);
        }
    }

    private static applyQueryMethod<TQuery extends object>(
        query: TQuery,
        methodName: string | undefined,
        ...args: SupabaseQueryMethodArg[]
    ): TQuery {
        if (!methodName) return query;
        const method = (query as { [method: string]: unknown })[methodName];
        if (typeof method !== 'function') return query;
        const queryMethod = method as (this: TQuery, ...queryArgs: SupabaseQueryMethodArg[]) => TQuery;
        return queryMethod.apply(query, args);
    }

    private static resolveFilterOperation(
        operator: string,
        value: SupabaseFilterValue
    ): ResolvedFilterOperation | null {
        switch (operator) {
            case '$eq':
                return SupabaseFilters.createOperation('eq', value);
            case '$ne':
                return SupabaseFilters.createOperation('neq', value);
            case '$lt':
                return SupabaseFilters.createOperation('lt', value);
            case '$lte':
                return SupabaseFilters.createOperation('lte', value);
            case '$gt':
                return SupabaseFilters.createOperation('gt', value);
            case '$gte':
                return SupabaseFilters.createOperation('gte', value);
            case '$iLike:contains':
                return SupabaseFilters.createOperation('ilike', SupabaseFilters.formatLikeValue(value, 'contains'));
            case '$notILike:contains': {
                const pattern = SupabaseFilters.formatLikeValue(value, 'contains');
                const postgrestValue = SupabaseFilters.formatPostgrestValue(pattern);
                return {
                    methodName: 'not',
                    queryArgs: ['ilike', postgrestValue],
                    postgrestOperator: 'not.ilike',
                    postgrestValue,
                };
            }
            case '$iLike:startsWith':
                return SupabaseFilters.createOperation('ilike', SupabaseFilters.formatLikeValue(value, 'startsWith'));
            case '$iLike:endsWith':
                return SupabaseFilters.createOperation('ilike', SupabaseFilters.formatLikeValue(value, 'endsWith'));
            case '$eq:null':
                return SupabaseFilters.createOperation('is', null);
            case '$ne:null':
                return {
                    methodName: 'not',
                    queryArgs: ['is', null],
                    postgrestOperator: 'not.is',
                    postgrestValue: 'null',
                };
            case '$in':
                return SupabaseFilters.createInOperation('in', SupabaseFilters.toArray(value));
            case '$notIn': {
                const postgrestValue = SupabaseFilters.formatPostgrestInValue(SupabaseFilters.toArray(value));
                return {
                    methodName: 'not',
                    queryArgs: ['in', postgrestValue],
                    postgrestOperator: 'not.in',
                    postgrestValue,
                };
            }
            case '$contains':
                return SupabaseFilters.createCollectionOperation('contains', value);
            case '$overlap':
                return SupabaseFilters.createCollectionOperation('overlaps', value);
            case '$notOverlap': {
                const postgrestValue = SupabaseFilters.formatPostgrestCollectionValue(value);
                return {
                    methodName: 'not',
                    queryArgs: ['ov', postgrestValue],
                    postgrestOperator: 'not.ov',
                    postgrestValue,
                };
            }
            default:
                return SupabaseFilters.resolveRawFilterOperation(operator, value);
        }
    }

    private static resolveRawFilterOperation(operator: string, value: SupabaseFilterValue): ResolvedFilterOperation {
        if (operator === 'in') return SupabaseFilters.createInOperation('in', value);
        if (operator === 'contains' || operator === 'containedBy' || operator === 'overlaps') {
            return SupabaseFilters.createCollectionOperation(operator, value);
        }

        return SupabaseFilters.createOperation(operator, value);
    }

    private static createOperation(methodName: string, value: SupabaseFilterValue): ResolvedFilterOperation {
        return {
            methodName,
            queryArgs: [value],
            postgrestOperator: SupabaseFilters.POSTGREST_OP_OVERRIDES[methodName] || methodName,
            postgrestValue: SupabaseFilters.formatPostgrestValue(value),
        };
    }

    private static createInOperation(
        methodName: string,
        value: SupabaseFilterValue,
        postgrestOperator = methodName
    ): ResolvedFilterOperation {
        return {
            methodName,
            queryArgs: [value],
            postgrestOperator,
            postgrestValue: SupabaseFilters.formatPostgrestInValue(value),
        };
    }

    private static createCollectionOperation(
        methodName: string,
        value: SupabaseFilterValue
    ): ResolvedFilterOperation {
        return {
            methodName,
            queryArgs: [value],
            postgrestOperator: SupabaseFilters.POSTGREST_OP_OVERRIDES[methodName] || methodName,
            postgrestValue: SupabaseFilters.formatPostgrestCollectionValue(value),
        };
    }

    private static formatLikeValue(value: SupabaseFilterValue, mode: 'contains' | 'startsWith' | 'endsWith'): string {
        const text = SupabaseFilters.stringifyPostgrestValue(value);
        if (mode === 'startsWith') return `${text}%`;
        if (mode === 'endsWith') return `%${text}`;
        return `%${text}%`;
    }

    private static toArray(value: SupabaseFilterValue): SupabaseFilterValue[] {
        return Array.isArray(value) ? value : [value];
    }

    private static formatPostgrestInValue(value: SupabaseFilterValue): string {
        return `(${SupabaseFilters.formatPostgrestListValue(value)})`;
    }

    private static formatPostgrestCollectionValue(value: SupabaseFilterValue): string {
        if (!Array.isArray(value)) return SupabaseFilters.formatPostgrestValue(value);
        return `{${SupabaseFilters.formatPostgrestListValue(value)}}`;
    }

    private static formatPostgrestListValue(value: SupabaseFilterValue): string {
        if (!Array.isArray(value)) return SupabaseFilters.formatPostgrestValue(value);
        return value.map(SupabaseFilters.formatPostgrestValue).join(',');
    }

    private static formatPostgrestValue(value: SupabaseFilterValue): string {
        const text = SupabaseFilters.stringifyPostgrestValue(value);
        return typeof value === 'string' ? SupabaseFilters.escapePostgrestString(text) : text;
    }

    private static stringifyPostgrestValue(value: SupabaseFilterValue): string {
        if (value === null) return 'null';
        if (typeof value === 'string') return value;
        if (typeof value === 'object') return JSON.stringify(value);
        return `${value}`;
    }

    private static escapePostgrestString(value: string): string {
        if (!/[,(){}"\\]/.test(value)) return value;
        return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
    }
}
