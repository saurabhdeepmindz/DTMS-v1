import DATABASE_SCHEMA from '../../data/databaseSchema.json' with { type: 'json' };
import wewebService from '../weweb.service.js';
import type { DatabaseSchema, Filter, IncludeConfig, SortOption } from './queryBuilder.ts';

const SCHEMA_PROMISE_KEY = Symbol('databaseSchemaPromise');

type SchemaCacheTarget = {
    [SCHEMA_PROMISE_KEY]?: Map<string, Promise<DatabaseSchema | null>>;
};

function getPackagedDatabaseSchema() {
    return DATABASE_SCHEMA as DatabaseSchema;
}

function hasFilterValues(filter?: Filter | null): boolean {
    if (!filter) return false;
    if ('field' in filter && 'operator' in filter) return Object.hasOwn(filter, 'value');
    if ('conditions' in filter && Array.isArray(filter.conditions)) {
        return filter.conditions.some(condition => hasFilterValues(condition));
    }
    return false;
}

function hasIncludeFilterValues(includes?: IncludeConfig[] | null): boolean {
    return Array.isArray(includes) && includes.some(include => hasFilterValues(include.filters));
}

function hasDataValues(data?: Record<string, unknown> | Array<Record<string, unknown>> | null): boolean {
    if (Array.isArray(data)) return data.some(row => row && Object.keys(row).length > 0);
    return !!data && Object.keys(data).length > 0;
}

function hasIgnoreCaseSort(sort?: SortOption[], includes?: IncludeConfig[]): boolean {
    return (
        !!sort?.some(option => option.ignoreCase === true) ||
        !!includes?.some(include => hasIgnoreCaseSort(include.sort))
    );
}

async function getEditorDatabaseSchema(env: string | undefined, cacheTarget?: SchemaCacheTarget) {
    const schemaEnv = env || 'production';
    if (!cacheTarget) return wewebService.getDatabaseSchema(schemaEnv);
    if (!cacheTarget[SCHEMA_PROMISE_KEY]) {
        cacheTarget[SCHEMA_PROMISE_KEY] = new Map();
    }
    if (!cacheTarget[SCHEMA_PROMISE_KEY].has(schemaEnv)) {
        cacheTarget[SCHEMA_PROMISE_KEY].set(schemaEnv, wewebService.getDatabaseSchema(schemaEnv));
    }
    return cacheTarget[SCHEMA_PROMISE_KEY].get(schemaEnv)!;
}

async function getDatabaseSchema(env?: string, cacheTarget?: SchemaCacheTarget): Promise<DatabaseSchema | null> {
    if (process.env.ENV !== 'editor') return getPackagedDatabaseSchema();

    try {
        return await getEditorDatabaseSchema(env, cacheTarget);
    } catch {
        return null;
    }
}

export default {
    getDatabaseSchema,
    hasDataValues,
    hasFilterValues,
    hasIncludeFilterValues,
    hasIgnoreCaseSort,
};
