import { isPlainObject } from '../../../utils/objectGuards.ts';
import type {
    SupabaseColumnObject,
    SupabaseColumnSelection,
    SupabaseFilterField,
    SupabaseJoinTypes,
} from '../supabase.types.ts';
import { getFilterFieldPath } from './supabaseGuards.ts';
import { SupabaseRelation } from './supabaseRelation.ts';

export type ResolvedSupabaseField = {
    column: string;
    relationPaths: string[];
    scope: string;
    scopedColumn: string;
};

class SupabaseColumnRelation {
    private readonly relation: SupabaseRelation;
    private readonly columns: SupabaseColumns;

    constructor(key: string, value: SupabaseColumnObject) {
        this.relation = new SupabaseRelation(key, value);
        this.columns = new SupabaseColumns(this.relation.selection);
    }

    get filterKey(): string {
        return this.relation.filterKey;
    }

    get childColumns(): SupabaseColumns {
        return this.columns;
    }

    toSelectString(joinTypes: SupabaseJoinTypes, path: string[]): string {
        const hint = joinTypes[path.join('.')] === 'inner' ? '!inner' : '';
        return `${this.relation.selectKey}${hint}(${this.columns.toSelectString(joinTypes, path)})`;
    }
}

export class SupabaseColumns {
    private hasWildcard = false;
    private readonly columns: string[] = [];
    private readonly relations = new Map<string, SupabaseColumnRelation>();
    private readonly isStructured: boolean;

    static withRelationPaths(
        selection: SupabaseColumnSelection | undefined,
        relationPaths: string[][]
    ): SupabaseColumnSelection | undefined {
        const paths = relationPaths.map(path => path.filter(SupabaseColumns.isRelationKey)).filter(path => path.length);
        if (!paths.length) return selection;

        const nextSelection = SupabaseColumns.createSelectionObject(selection);
        for (const path of paths) {
            SupabaseColumns.addRelationPath(nextSelection, path);
        }
        return nextSelection;
    }

    constructor(selection?: SupabaseColumnSelection) {
        this.isStructured = this.parse(selection);
    }

    toSelectString(joinTypes: SupabaseJoinTypes = {}, path: string[] = []): string {
        const fragments = [...this.columns];
        if (this.hasWildcard) fragments.unshift('*');

        for (const [key, relation] of this.relations) {
            fragments.push(relation.toSelectString(joinTypes, [...path, key]));
        }

        return fragments.join(', ') || '*';
    }

    private parse(selection?: SupabaseColumnSelection): boolean {
        if (!selection || selection === true || selection === '*') {
            this.hasWildcard = true;
            return false;
        }

        if (Array.isArray(selection)) {
            for (const column of selection) {
                if (typeof column === 'string') this.columns.push(column);
            }
            return false;
        }

        if (!isPlainObject<SupabaseColumnObject>(selection)) {
            this.hasWildcard = true;
            return false;
        }

        for (const [key, value] of Object.entries(selection)) {
            if (key.startsWith('$') || value === false) continue;
            if (key === '*') {
                this.hasWildcard = true;
                continue;
            }
            if (value === true) {
                this.columns.push(key);
                continue;
            }
            const aliasedColumn = SupabaseColumns.getAliasedScalarColumn(key, value);
            if (aliasedColumn) {
                this.columns.push(aliasedColumn);
                continue;
            }
            if (!SupabaseRelation.isRelationValue(value)) continue;
            this.relations.set(key, new SupabaseColumnRelation(key, value));
        }

        return true;
    }

    resolveField(field?: SupabaseFilterField): ResolvedSupabaseField {
        const path = getFilterFieldPath(field);
        if (!path.length) return { column: '', relationPaths: [], scope: '', scopedColumn: '' };
        if (!this.isStructured || path.length === 1) {
            const column = path.join('.');
            return { column, relationPaths: [], scope: '', scopedColumn: column };
        }

        const columnPath: string[] = [];
        const relationPaths: string[] = [];
        const scopePath: string[] = [];
        const configPath: string[] = [];
        let currentColumns: SupabaseColumns | null = this;

        for (let index = 0; index < path.length; index += 1) {
            const key = path[index];

            if (index === path.length - 1) {
                columnPath.push(...path.slice(index));
                break;
            }

            const relation = currentColumns?.relations.get(key);
            if (!relation) {
                columnPath.push(key);
                currentColumns = null;
                continue;
            }

            configPath.push(key);
            relationPaths.push(configPath.join('.'));
            const filterKey = relation.filterKey;
            columnPath.push(filterKey);
            scopePath.push(filterKey);
            currentColumns = relation.childColumns;
        }

        const scope = scopePath.join('.');
        const scopedColumn = scopePath.length ? columnPath.slice(scopePath.length).join('.') : columnPath.join('.');
        return { column: columnPath.join('.'), relationPaths, scope, scopedColumn };
    }

    private static createSelectionObject(selection?: SupabaseColumnSelection): SupabaseColumnObject {
        if (!selection || selection === true || selection === '*') return { '*': true };

        if (Array.isArray(selection)) {
            const columns: SupabaseColumnObject = {};
            for (const column of selection) {
                if (typeof column === 'string') columns[column] = true;
            }
            return columns;
        }

        if (!isPlainObject<SupabaseColumnObject>(selection)) return { '*': true };
        return SupabaseColumns.cloneColumnObject(selection);
    }

    private static cloneColumnObject(selection: SupabaseColumnObject): SupabaseColumnObject {
        const clone: SupabaseColumnObject = {};
        for (const [key, value] of Object.entries(selection)) {
            clone[key] = isPlainObject<SupabaseColumnObject>(value) ? SupabaseColumns.cloneColumnObject(value) : value;
        }
        return clone;
    }

    private static addRelationPath(selection: SupabaseColumnObject, path: string[]) {
        let currentSelection = selection;

        for (const [index, key] of path.entries()) {
            const isLeaf = index === path.length - 1;
            const relation = SupabaseColumns.ensureRelation(currentSelection, key, isLeaf);
            if (index === path.length - 1) return;

            if (!isPlainObject<SupabaseColumnObject>(relation.$value)) relation.$value = relation.$value === '*' ? { '*': true } : {};
            currentSelection = relation.$value;
        }
    }

    private static ensureRelation(selection: SupabaseColumnObject, key: string, isLeaf: boolean): SupabaseColumnObject {
        const relation = SupabaseColumns.createRelationObject(selection[key], key, isLeaf ? '*' : {});
        selection[key] = relation;
        return relation;
    }

    private static createRelationObject(
        value: unknown,
        key: string,
        fallbackValue: SupabaseColumnSelection
    ): SupabaseColumnObject {
        const relation = isPlainObject<SupabaseColumnObject>(value) ? SupabaseColumns.normalizeRelationObject(value, fallbackValue) : {};
        const relationName = SupabaseColumns.getRelationName(key);
        if (relationName && typeof relation.$relation !== 'string') relation.$relation = relationName;
        if (!Object.hasOwn(relation, '$value')) relation.$value = fallbackValue;
        return relation;
    }

    private static normalizeRelationObject(
        value: SupabaseColumnObject,
        fallbackValue: SupabaseColumnSelection
    ): SupabaseColumnObject {
        const relation: SupabaseColumnObject = {};
        const childSelection: SupabaseColumnObject = {};

        for (const [key, childValue] of Object.entries(value)) {
            if (key.startsWith('$')) {
                relation[key] = isPlainObject<SupabaseColumnObject>(childValue) ? SupabaseColumns.cloneColumnObject(childValue) : childValue;
            } else {
                childSelection[key] = isPlainObject<SupabaseColumnObject>(childValue) ? SupabaseColumns.cloneColumnObject(childValue) : childValue;
            }
        }

        if (Object.hasOwn(relation, '$value')) return relation;
        relation.$value = Object.keys(childSelection).length ? childSelection : fallbackValue;
        return relation;
    }

    private static getRelationName(key: string): string | null {
        const parts = key.split('__');
        return parts.length > 1 && parts[1] ? parts[1] : null;
    }

    private static getAliasedScalarColumn(key: string, value: unknown): string | null {
        if (!isPlainObject<SupabaseColumnObject>(value)) return null;
        if (typeof value.$relation === 'string') return null;
        if (value.$value !== true) return null;

        const alias = typeof value.$alias === 'string' ? value.$alias.trim() : '';
        if (!alias || alias === key) return key;
        return `${alias}:${key}`;
    }

    private static isRelationKey(key: string): boolean {
        return key.includes('__');
    }
}
