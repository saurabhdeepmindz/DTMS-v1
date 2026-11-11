import { isPlainObject } from '../../../utils/objectGuards.ts';
import type { SupabaseColumnObject, SupabaseColumnSelection, SupabaseColumnValue } from '../supabase.types.ts';

export class SupabaseRelation {
    private readonly key: string;
    private readonly value: SupabaseColumnObject;

    constructor(key: string, value: SupabaseColumnObject) {
        this.key = key;
        this.value = value;
    }

    static isRelationValue(value: SupabaseColumnValue): value is SupabaseColumnObject {
        if (!isPlainObject<SupabaseColumnObject>(value)) return false;
        return typeof value.$relation === 'string';
    }

    get filterKey(): string {
        return this.selectKey.split(':')[0];
    }

    get selectKey(): string {
        const alias = this.alias || this.key;
        const target = this.relationTarget;
        return alias === target ? target : `${alias}:${target}`;
    }

    get selection(): SupabaseColumnSelection | undefined {
        if (Object.hasOwn(this.value, '$value')) return this.value.$value;
        return this.value;
    }

    private get alias(): string | null {
        return typeof this.value.$alias === 'string' ? this.value.$alias : null;
    }

    private get relationTarget(): string {
        const relation = this.relationName;
        if (relation.includes('!')) return relation;

        // Saved table views identify forward references as FK__table and reverse references as table__FK.
        const suffix = `__${relation}`;
        if (this.key.endsWith(suffix) && this.key.length > suffix.length) {
            return `${relation}!${this.key.slice(0, -suffix.length)}`;
        }
        const prefix = `${relation}__`;
        if (this.key.startsWith(prefix) && this.key.length > prefix.length) {
            return `${relation}!${this.key.slice(prefix.length)}`;
        }

        return relation;
    }

    private get relationName(): string {
        const nestedValue = isPlainObject<SupabaseColumnObject>(this.value.$value) ? this.value.$value : null;
        const relation =
            (typeof this.value.$relation === 'string' && this.value.$relation) ||
            (typeof nestedValue?.$relation === 'string' && nestedValue.$relation);

        return relation || this.key;
    }
}
