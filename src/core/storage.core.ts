import { Disk, KeyNormalizer } from 'flydrive';
import type { DriverContract, ObjectMetaData, SignedURLOptions, WriteOptions } from 'flydrive/types';
import {
    StorageError,
    StorageConflictError,
    StorageNotFoundError,
    StorageUnsupportedOperationError,
    StorageInvalidPathError,
    normalizeStorageError,
} from './storage.errors.ts';
import { getConnections, resolveConnectionConfig } from '../services/connection.service.js';
import { getEnv, type RuntimeEnv } from '../services/env.service.ts';
import { getEditorRuntime, type EditorRuntime } from '../services/editorRuntime.service.ts';
import { getStorageDriver } from '../services/storageDriverRegistry.service.ts';
import databaseService from '../services/database/database.service.ts';
import { promisePool } from '../utils/promisePool.ts';

const keyNormalizer = new KeyNormalizer();

export type StorageAccess = 'public' | 'private';
export type StorageEnv = RuntimeEnv;

export const normalizePath = (path: string, options: { catchError?: boolean } = {}): string => {
    try {
        if (typeof path !== 'string') throw new StorageInvalidPathError('File path must be a string');
        return keyNormalizer.normalize(path);
    } catch (error) {
        if (options.catchError) return '';
        throw normalizeStorageError(error);
    }
};

export function normalizeStorageAccess(access: string): StorageAccess {
    if (access === 'public' || access === 'private') return access;
    throw new Error('Invalid storage access');
}

export function normalizeStorageEnv(env: string = 'current'): StorageEnv {
    if (env === 'current' || env === 'editor' || env === 'staging' || env === 'production') return env;
    throw new Error('Invalid storage environment');
}

export const ACCESS_TABLE_NAME: Record<StorageAccess, string> = {
    public: 'publicFiles',
    private: 'privateFiles',
};

type StorageOptions = {
    overwrite?: boolean;
    expiresIn?: number | string;
} & Record<string, unknown>;

type StorageWriteOptions = WriteOptions & StorageOptions;
type StorageSignedUrlOptions = SignedURLOptions & StorageOptions;
type StorageCopyMoveOptions = WriteOptions & StorageOptions;
type StorageData = Parameters<DriverContract['put']>[1];
type StorageBatchSignedUploadFile = {
    path: string;
    options?: StorageSignedUrlOptions;
};
type StorageBatchMoveCopyFile = {
    source: string;
    destination: string;
    options?: StorageCopyMoveOptions;
};
type StorageFolderOperationResult = {
    total: number;
    succeeded: string[];
    failed: { source: string; destination?: string; message: string }[];
};
type StorageBatchOperationFailure = {
    source?: string;
    path?: string;
    destination?: string;
    signedUploadUrl?: string;
    message: string;
    code?: string;
    status?: number;
};
type StorageBatchMoveCopyResult = {
    total: number;
    succeeded: { source: string; destination: string; result: unknown }[];
    failed: StorageBatchOperationFailure[];
};
type StorageBatchDeleteResult = {
    total: number;
    deleted: string[];
    failed: StorageBatchOperationFailure[];
};
type StorageBatchSignedUploadUrlResult = {
    signed: { path: string; signedUploadUrl: string }[];
    failed: StorageBatchOperationFailure[];
};
type StorageBatchConfirmUploadResult = {
    confirmed: unknown[];
    failed: StorageBatchOperationFailure[];
};
type StorageBatchItemResult<T> = { ok: true; value: T } | { ok: false; failure: StorageBatchOperationFailure };
type StorageFileLookupColumns = Record<string, true>;
type StorageFileLookupRow = {
    path: string;
};
type StorageFileLookupMap<T extends StorageFileLookupRow = StorageFileLookupRow> = Map<string, T>;
type FindFileOptions = {
    includePendingUpload?: boolean;
};
type StorageFileRow = {
    path: string;
    type?: string | null;
    size?: string | number | null;
};
type StorageEnvironmentCopyOptions = {
    batchSize?: number;
    concurrency?: number;
};
type StorageEnvironmentCopyAccessSummary = {
    total: number;
    copied: number;
    skippedExisting: number;
    missingSource: number;
    failed: number;
    failures: StorageBatchOperationFailure[];
};
type StorageEnvironmentCopySummary = Record<StorageAccess, StorageEnvironmentCopyAccessSummary> & {
    sourceEnv: StorageEnv;
    targetEnv: StorageEnv;
};

type StorageRuntimeConfig = {
    env: StorageEnv;
    integration?: string;
    connectionId?: string;
    cdnUrl?: string;
    privateBucket?: string;
    publicBucket?: string;
    privatePrefix?: string;
    publicPrefix?: string;
    appUrl?: string;
    proxyUrl?: string;
    projectId?: string;
};

const STORAGE_BATCH_CONCURRENCY = 8;
const STORAGE_ENVIRONMENT_COPY_BATCH_SIZE = 200;
const STORAGE_ENVIRONMENT_COPY_FAILURE_LIMIT = 25;
const STORAGE_FILE_LOOKUP_COLUMNS = { path: true } satisfies StorageFileLookupColumns;
const STORAGE_CONNECTION_ENV_KEYS: Record<
    string,
    { name: string; required: Record<string, string>; optional?: Record<string, string> }
> = {
    'aws-s3': {
        name: 'AWS S3',
        required: {
            region: 'AWS_S3_REGION',
            accessKeyId: 'AWS_S3_ACCESS_KEY_ID',
            secretAccessKey: 'AWS_S3_SECRET_ACCESS_KEY',
        },
    },
    's3-compatible': {
        name: 'S3 compatible',
        required: {
            region: 'S3_COMPATIBLE_REGION',
            accessKeyId: 'S3_COMPATIBLE_ACCESS_KEY_ID',
            secretAccessKey: 'S3_COMPATIBLE_SECRET_ACCESS_KEY',
            endpoint: 'S3_COMPATIBLE_ENDPOINT',
        },
        optional: { forcePathStyle: 'S3_COMPATIBLE_FORCE_PATH_STYLE' },
    },
    cloudflare: {
        name: 'Cloudflare R2',
        required: {
            accountId: 'CLOUDFLARE_ACCOUNT_ID',
            accessKeyId: 'CLOUDFLARE_ACCESS_KEY_ID',
            secretAccessKey: 'CLOUDFLARE_SECRET_ACCESS_KEY',
        },
    },
};

function toStorageBatchFailure(
    error: unknown,
    context: Omit<StorageBatchOperationFailure, 'message' | 'code' | 'status'>
): StorageBatchOperationFailure {
    error = normalizeStorageError(error);
    return {
        ...context,
        message: String((error as Error)?.message || error),
        code: error instanceof StorageError ? error.code : undefined,
        status: error instanceof StorageError ? error.status : undefined,
    };
}

function getDatabaseEnv(env: StorageEnv) {
    if (env === 'current') return null;
    return env;
}

function resolveSelfHostedStorageConnection(
    access: StorageAccess,
    runtimeConfig: StorageRuntimeConfig
): ConnectionConfig | null {
    if (!runtimeConfig.integration || !Object.hasOwn(STORAGE_CONNECTION_ENV_KEYS, runtimeConfig.integration)) return null;
    const provider = STORAGE_CONNECTION_ENV_KEYS[runtimeConfig.integration];

    const connectionConfig: ConnectionConfig = {};
    const missingEnvNames: string[] = [];

    for (const [configName, envName] of Object.entries(provider.required)) {
        const value = getEnv(envName, runtimeConfig.env);
        if (!value) {
            missingEnvNames.push(envName);
            continue;
        }
        connectionConfig[configName] = value;
    }

    const bucketEnvName = access === 'private' ? 'STORAGE_PRIVATE_BUCKET' : 'STORAGE_PUBLIC_BUCKET';
    if (!getEnv(bucketEnvName, runtimeConfig.env)) missingEnvNames.push(bucketEnvName);

    if (missingEnvNames.length) {
        throw new Error(`Missing ${provider.name} storage configuration: ${missingEnvNames.join(', ')}`);
    }

    for (const [configName, envName] of Object.entries(provider.optional || {})) {
        connectionConfig[configName] = getEnv(envName, runtimeConfig.env);
    }
    return connectionConfig;
}

function getNormalizedUniquePaths(paths: readonly string[]): string[] {
    const seen = new Set<string>();
    const normalizedPaths: string[] = [];

    for (const path of paths) {
        const normalizedPath = normalizePath(path, { catchError: true });
        if (!normalizedPath || seen.has(normalizedPath)) continue;
        seen.add(normalizedPath);
        normalizedPaths.push(normalizedPath);
    }

    return normalizedPaths;
}

function getDuplicateNormalizedPaths(paths: readonly string[]): Set<string> {
    const seen = new Set<string>();
    const duplicates = new Set<string>();

    for (const path of paths) {
        const normalizedPath = normalizePath(path, { catchError: true });
        if (!normalizedPath) continue;
        if (seen.has(normalizedPath)) {
            duplicates.add(normalizedPath);
            continue;
        }
        seen.add(normalizedPath);
    }

    return duplicates;
}

export function resolveStorageRuntimeConfig(env: StorageEnv = 'current'): StorageRuntimeConfig {
    const normalizedEnv = normalizeStorageEnv(env);

    return {
        env: normalizedEnv,
        integration: getEnv('STORAGE_INTEGRATION', normalizedEnv),
        connectionId: getEnv('STORAGE_CONNECTION_ID', normalizedEnv),
        cdnUrl: getEnv('STORAGE_CDN_URL', normalizedEnv),
        privateBucket: getEnv('STORAGE_PRIVATE_BUCKET', normalizedEnv),
        publicBucket: getEnv('STORAGE_PUBLIC_BUCKET', normalizedEnv),
        privatePrefix: getEnv('STORAGE_PRIVATE_PREFIX', normalizedEnv) ?? 'private/',
        publicPrefix: getEnv('STORAGE_PUBLIC_PREFIX', normalizedEnv) ?? 'public/',
        appUrl: getEnv('APP_URL', normalizedEnv),
        proxyUrl: getEnv('S3_LAMBDA_URL', normalizedEnv),
        projectId: getEnv('WEWEB_PROJECT_ID', normalizedEnv),
    };
}

export function getFileBaseData(path: string) {
    const normalizedPath = normalizePath(path);
    const name = normalizedPath.split('/').pop();

    return {
        path: normalizedPath,
        name,
        prefix: normalizedPath.split('/').slice(0, -1).join('/'),
        ext: name?.split('.').pop() || '',
    };
}

function normalizeContentType(contentType: unknown): string {
    if (typeof contentType !== 'string') return 'application/octet-stream';
    const normalizedContentType = contentType.trim();
    return normalizedContentType || 'application/octet-stream';
}

async function findFile(
    access: StorageAccess,
    path: string,
    env: StorageEnv = 'current',
    options: FindFileOptions = {}
) {
    const normalizedPath = normalizePath(path);
    const conditions: { field: string; operator: string; value?: string }[] = [
        { field: 'path', operator: '$eq', value: normalizedPath },
    ];

    if (!options.includePendingUpload) {
        conditions.push({ field: 'signedUploadUrl', operator: '$eq:null' });
    }

    const selectQuery = databaseService.getSelectQuery({
        schema: 'storage',
        table: ACCESS_TABLE_NAME[access],
        columns: { path: true },
        filters: {
            link: '$and',
            conditions,
        },
    });
    const result = await databaseService.execute({
        ...selectQuery,
        env: getDatabaseEnv(env),
    });
    return result[0] || null;
}

export async function findFilesByPath<T extends StorageFileLookupRow = StorageFileLookupRow>(
    access: StorageAccess,
    paths: readonly string[],
    env: StorageEnv = 'current',
    columns: StorageFileLookupColumns = STORAGE_FILE_LOOKUP_COLUMNS
): Promise<StorageFileLookupMap<T>> {
    const normalizedAccess = normalizeStorageAccess(access);
    const normalizedEnv = normalizeStorageEnv(env);
    const normalizedPaths = getNormalizedUniquePaths(paths);

    if (!normalizedPaths.length) return new Map();

    const selectQuery = databaseService.getSelectQuery({
        schema: 'storage',
        table: ACCESS_TABLE_NAME[normalizedAccess],
        columns,
        filters: {
            link: '$and',
            conditions: [
                { field: 'path', operator: '$in', value: normalizedPaths },
                { field: 'signedUploadUrl', operator: '$eq:null' },
            ],
        },
    });
    const result = (await databaseService.execute({
        ...selectQuery,
        env: getDatabaseEnv(normalizedEnv),
    })) as T[];

    return new Map(result.map(file => [file.path, file]));
}

async function getStorageEnvironmentFileCount(access: StorageAccess, env: StorageEnv) {
    const pool = databaseService.getPool(getDatabaseEnv(env));
    if (!pool) throw new Error(`No database pool available for environment: ${env}`);

    try {
        const result = await pool.query(`
            SELECT COUNT(*)::int as count
            FROM storage."${ACCESS_TABLE_NAME[access]}"
            WHERE "signedUploadUrl" IS NULL
        `);
        return Number(result.rows[0]?.count) || 0;
    } catch (error) {
        if (isMissingStorageTableError(error)) return null;
        throw error;
    }
}

async function getStorageEnvironmentFileRows(access: StorageAccess, env: StorageEnv, limit: number, offset: number) {
    const pool = databaseService.getPool(getDatabaseEnv(env));
    if (!pool) throw new Error(`No database pool available for environment: ${env}`);

    const result = await pool.query(
        `
            SELECT "path", "type", "size"
            FROM storage."${ACCESS_TABLE_NAME[access]}"
            WHERE "signedUploadUrl" IS NULL
            ORDER BY "path"
            LIMIT $1 OFFSET $2
        `,
        [limit, offset]
    );

    return result.rows as StorageFileRow[];
}

async function assertFileExists(access: StorageAccess, path: string, env: StorageEnv = 'current') {
    const file = await findFile(access, path, env);
    if (!file) throw new StorageNotFoundError();
    return file;
}

async function assertFileDoesNotExist(access: StorageAccess, path: string, env: StorageEnv = 'current') {
    const file = await findFile(access, path, env);
    if (file) throw new StorageConflictError();
}

async function assertObjectExists(disk: Disk, path: string) {
    if (!(await disk.exists(path))) throw new StorageNotFoundError();
}

async function assertObjectDoesNotExist(disk: Disk, path: string) {
    if (await disk.exists(path)) throw new StorageConflictError();
}

function isUnsupportedOperationError(error: unknown) {
    const message = String((error as Error)?.message || '').toLowerCase();
    return message.includes('unsupported operation');
}

function isMissingStorageTableError(error: unknown) {
    const code = (error as { code?: string })?.code;
    if (code === '42P01' || code === '3F000') return true;

    const message = String((error as Error)?.message || '').toLowerCase();
    return message.includes('relation "storage.') || message.includes('schema "storage" does not exist');
}

function createStorageEnvironmentCopyAccessSummary(): StorageEnvironmentCopyAccessSummary {
    return {
        total: 0,
        copied: 0,
        skippedExisting: 0,
        missingSource: 0,
        failed: 0,
        failures: [],
    };
}

function addStorageEnvironmentCopyFailure(
    summary: StorageEnvironmentCopyAccessSummary,
    path: string,
    error: unknown
) {
    summary.failed += 1;
    if (summary.failures.length >= STORAGE_ENVIRONMENT_COPY_FAILURE_LIMIT) return;
    summary.failures.push(toStorageBatchFailure(error, { path }));
}

function normalizePositiveInteger(value: unknown, fallback: number) {
    const parsedValue = Number(value);
    if (!Number.isInteger(parsedValue) || parsedValue <= 0) return fallback;
    return parsedValue;
}

function normalizeStorageContentLength(value: unknown) {
    if (typeof value === 'number') {
        if (!Number.isFinite(value) || value < 0) return undefined;
        return value;
    }

    if (typeof value !== 'string' || !value.trim()) return undefined;

    const numberValue = Number(value);
    if (!Number.isFinite(numberValue) || numberValue < 0) return undefined;
    return numberValue;
}

function getStorageWriteOptions(metadata: ObjectMetaData | null, row: StorageFileRow): StorageWriteOptions {
    const contentLength = normalizeStorageContentLength(metadata?.contentLength ?? row.size);
    return {
        contentType: metadata?.contentType || row.type || 'application/octet-stream',
        ...(contentLength === undefined ? {} : { contentLength }),
    };
}

function normalizeFolderPrefix(prefix: string) {
    const normalizedPrefix = normalizePath(prefix || '', { catchError: true });
    return normalizedPrefix.replace(/\/+$/g, '');
}

function getPathInFolder(path: string, sourcePrefix: string, destinationPrefix: string) {
    const normalizedPath = normalizePath(path);
    const normalizedSourcePrefix = normalizeFolderPrefix(sourcePrefix);
    const normalizedDestinationPrefix = normalizeFolderPrefix(destinationPrefix);
    const relativePath = normalizedSourcePrefix
        ? normalizedPath.slice(normalizedSourcePrefix.length).replace(/^\/+/, '')
        : normalizedPath;

    return normalizePath([normalizedDestinationPrefix, relativePath].filter(Boolean).join('/'));
}

async function deleteFileFromDatabase(access: StorageAccess, path: string, env: StorageEnv) {
    const normalizedPath = normalizePath(path);
    const deleteQuery = databaseService.getDeleteQuery({
        schema: 'storage',
        table: ACCESS_TABLE_NAME[access],
        filters: {
            link: '$and',
            conditions: [{ field: 'path', operator: '$eq', value: normalizedPath }],
        },
    });
    await databaseService.execute({
        ...deleteQuery,
        env: getDatabaseEnv(env),
    });
}

async function updateMovedFileInDatabase(
    access: StorageAccess,
    source: string,
    destination: string,
    overwrite: boolean,
    env: StorageEnv
) {
    const normalizedSource = normalizePath(source);
    const normalizedDestination = normalizePath(destination);
    const fileBaseData = getFileBaseData(destination);

    if (overwrite) {
        const pool = databaseService.getPool(getDatabaseEnv(env));
        if (!pool) {
            throw new Error(`No database pool available for environment: ${env}`);
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await client.query(
                `
                    DELETE FROM storage."${ACCESS_TABLE_NAME[access]}"
                    WHERE path = $1 AND path <> $2
                `,
                [normalizedDestination, normalizedSource]
            );
            const result = await client.query(
                `
                    UPDATE storage."${ACCESS_TABLE_NAME[access]}"
                    SET path = $1, name = $3, prefix = $4, ext = $5
                    WHERE path = $2
                    RETURNING *
                `,
                [normalizedDestination, normalizedSource, fileBaseData.name, fileBaseData.prefix, fileBaseData.ext]
            );
            await client.query('COMMIT');
            return result.rows[0];
        } catch (error) {
            await client.query('ROLLBACK').catch(() => {});
            throw error;
        } finally {
            client.release();
        }
    }

    const updateQuery = databaseService.getUpdateQuery({
        schema: 'storage',
        table: ACCESS_TABLE_NAME[access],
        filters: {
            link: '$and',
            conditions: [{ field: 'path', operator: '$eq', value: normalizedSource }],
        },
        data: {
            ...fileBaseData,
            path: normalizedDestination,
        },
        returnData: true,
    });
    const result = await databaseService.execute({
        ...updateQuery,
        env: getDatabaseEnv(env),
    });

    return result[0];
}

export const get = async (access: StorageAccess, path: string, env: StorageEnv = 'current') => {
    const normalizedAccess = normalizeStorageAccess(access);
    const normalizedEnv = normalizeStorageEnv(env);
    const disk = getDisk(normalizedAccess, normalizedEnv);

    await assertFileExists(normalizedAccess, path, normalizedEnv);

    return await disk.get(path);
};

export const getBytes = async (access: StorageAccess, path: string, env: StorageEnv = 'current') => {
    const normalizedAccess = normalizeStorageAccess(access);
    const normalizedEnv = normalizeStorageEnv(env);
    const disk = getDisk(normalizedAccess, normalizedEnv);

    await assertFileExists(normalizedAccess, path, normalizedEnv);

    return await disk.getBytes(path);
};

export const put = async (
    access: StorageAccess,
    path: string,
    data: StorageData,
    options: StorageWriteOptions = {},
    env: StorageEnv = 'current'
) => {
    const normalizedAccess = normalizeStorageAccess(access);
    const normalizedEnv = normalizeStorageEnv(env);
    const disk = getDisk(normalizedAccess, normalizedEnv);

    if (!options.overwrite) {
        await assertObjectDoesNotExist(disk, path);
        await assertFileDoesNotExist(normalizedAccess, path, normalizedEnv);
    }

    await disk.put(path, data, options);

    const metadata = await disk.getMetaData(path);
    const upsertQuery = databaseService.getInsertQuery({
        schema: 'storage',
        table: ACCESS_TABLE_NAME[normalizedAccess],
        data: {
            ...getFileBaseData(path),
            size: metadata.contentLength,
            type: metadata.contentType,
        },
        upsert: true,
        primaryColumn: 'path',
        returnData: true,
    });
    const result = await databaseService.execute({
        ...upsertQuery,
        env: getDatabaseEnv(normalizedEnv),
    });

    return result[0];
};

export const getSignedUrl = async (
    access: StorageAccess,
    path: string,
    options: StorageSignedUrlOptions = {},
    env: StorageEnv = 'current'
) => {
    const normalizedAccess = normalizeStorageAccess(access);
    const normalizedEnv = normalizeStorageEnv(env);
    const disk = getDisk(normalizedAccess, normalizedEnv);

    await assertFileExists(normalizedAccess, path, normalizedEnv);

    return await disk.getSignedUrl(path, options as StorageSignedUrlOptions);
};

async function deleteExpiredSignedUploadUrls(access: StorageAccess, env: StorageEnv) {
    const expiredUploads = {
        schema: 'storage',
        table: ACCESS_TABLE_NAME[access],
        filters: {
            link: '$and' as const,
            conditions: [
                { field: 'signedUploadUrl', operator: '$ne:null' },
                { field: 'signedUploadUrlExpiresAt', operator: '$lt', value: new Date(Date.now()) },
            ],
        },
    };
    const databaseEnv = getDatabaseEnv(env);
    try {
        await databaseService.execute({
            ...databaseService.getDeleteQuery(expiredUploads),
            env: databaseEnv,
        });
        return;
    } catch (error) {
        if ((error as { code?: string })?.code !== '23503') throw error;
    }

    // A foreign key rolls back the entire bulk DELETE. Retry separately so protected
    // pending identities do not prevent unrelated abandoned uploads from being removed.
    const pendingFiles = await databaseService.execute({
        ...databaseService.getSelectQuery({ ...expiredUploads, columns: { path: true } }),
        env: databaseEnv,
    });
    for (const { path } of pendingFiles) {
        const deleteQuery = databaseService.getDeleteQuery({
            ...expiredUploads,
            filters: {
                ...expiredUploads.filters,
                // Recheck expiry and pending state in case another request renewed or confirmed it.
                conditions: [...expiredUploads.filters.conditions, { field: 'path', operator: '$eq', value: path }],
            },
        });
        try {
            await databaseService.execute({ ...deleteQuery, env: databaseEnv });
        } catch (error) {
            if ((error as { code?: string })?.code !== '23503') throw error;
        }
    }
}

async function createSignedUploadUrl(
    access: StorageAccess,
    path: string,
    options: StorageSignedUrlOptions,
    env: StorageEnv,
    existingFilesByPath?: StorageFileLookupMap
) {
    const disk = getDisk(access, env);

    if (!options.overwrite) {
        await assertObjectDoesNotExist(disk, path);
        const normalizedPath = normalizePath(path, { catchError: true });
        const existingFile = existingFilesByPath
            ? existingFilesByPath.get(normalizedPath) || null
            : await findFile(access, path, env);
        if (existingFile) throw new StorageConflictError();
    }

    const uploadSignedUrl = await disk.getSignedUploadUrl(path, options);

    const insertFile = databaseService.getInsertQuery({
        schema: 'storage',
        table: ACCESS_TABLE_NAME[access],
        data: {
            ...getFileBaseData(path),
            type: normalizeContentType(options.contentType),
            size: 0,
            signedUploadUrl: uploadSignedUrl,
            signedUploadUrlExpiresAt: new Date(Date.now() + (Number(options.expiresIn) || 60 * 30) * 1000),
        },
        upsert: true,
        primaryColumn: 'path',
        returnData: false,
    });
    await databaseService.execute({
        ...insertFile,
        env: getDatabaseEnv(env),
    });

    return uploadSignedUrl;
}

export const getSignedUploadUrl = async (
    access: StorageAccess,
    path: string,
    options: StorageSignedUrlOptions = {},
    env: StorageEnv = 'current'
) => {
    const normalizedAccess = normalizeStorageAccess(access);
    const normalizedEnv = normalizeStorageEnv(env);
    normalizePath(path);

    await deleteExpiredSignedUploadUrls(normalizedAccess, normalizedEnv);

    return createSignedUploadUrl(normalizedAccess, path, options, normalizedEnv);
};

export const getSignedUploadUrls = async (
    access: StorageAccess,
    files: StorageBatchSignedUploadFile[],
    env: StorageEnv = 'current'
): Promise<StorageBatchSignedUploadUrlResult> => {
    const normalizedAccess = normalizeStorageAccess(access);
    const normalizedEnv = normalizeStorageEnv(env);

    await deleteExpiredSignedUploadUrls(normalizedAccess, normalizedEnv);
    const existingFilesByPath = await findFilesByPath(
        normalizedAccess,
        files.map(file => file.path),
        normalizedEnv
    );
    const duplicatePaths = getDuplicateNormalizedPaths(files.map(file => file.path));
    const results = await promisePool(
        files,
        async (
            file
        ): Promise<StorageBatchItemResult<StorageBatchSignedUploadUrlResult['signed'][number]>> => {
            try {
                const normalizedPath = normalizePath(file.path, { catchError: true });
                if (normalizedPath && duplicatePaths.has(normalizedPath)) {
                    throw new StorageConflictError('Duplicate upload path in request');
                }
                const signedUploadUrl = await createSignedUploadUrl(
                    normalizedAccess,
                    file.path,
                    file.options || {},
                    normalizedEnv,
                    existingFilesByPath
                );
                return { ok: true, value: { path: normalizePath(file.path), signedUploadUrl } };
            } catch (error) {
                return {
                    ok: false,
                    failure: toStorageBatchFailure(error, {
                        path: normalizePath(file.path, { catchError: true }) || file.path,
                    }),
                };
            }
        },
        STORAGE_BATCH_CONCURRENCY
    );

    const signed: StorageBatchSignedUploadUrlResult['signed'] = [];
    const failed: StorageBatchSignedUploadUrlResult['failed'] = [];
    for (const result of results) {
        if (result.ok === false) {
            failed.push(result.failure);
            continue;
        }
        signed.push(result.value);
    }

    return { signed, failed };
};

export const confirmSignedUploadUrl = async (
    access: StorageAccess,
    signedUploadUrl: string,
    env: StorageEnv = 'current'
) => {
    const normalizedAccess = normalizeStorageAccess(access);
    const normalizedEnv = normalizeStorageEnv(env);
    const selectQuery = databaseService.getSelectQuery({
        schema: 'storage',
        table: ACCESS_TABLE_NAME[normalizedAccess],
        columns: { path: true },
        filters: {
            link: '$and',
            conditions: [{ field: 'signedUploadUrl', operator: '$eq', value: signedUploadUrl }],
        },
        limit: 1,
    });
    const rows = (await databaseService.execute({
        ...selectQuery,
        env: getDatabaseEnv(normalizedEnv),
    })) as { path: string }[];

    if (!rows.length) throw new StorageNotFoundError('Signed upload URL not found');

    const path = rows[0].path;
    const disk = getDisk(normalizedAccess, normalizedEnv);

    if (!(await disk.exists(path))) throw new StorageNotFoundError();
    const fileMetadata = await disk.getMetaData(path);

    const normalizedPath = normalizePath(path, { catchError: true });
    const updateQuery = databaseService.getUpdateQuery({
        schema: 'storage',
        table: ACCESS_TABLE_NAME[normalizedAccess],
        data: {
            signedUploadUrl: null,
            signedUploadUrlExpiresAt: null,
            type: fileMetadata.contentType || 'application/octet-stream',
            size: fileMetadata.contentLength,
        },
        filters: {
            link: '$and',
            conditions: [
                { field: 'path', operator: '$eq', value: normalizedPath },
                { field: 'signedUploadUrl', operator: '$eq', value: signedUploadUrl },
            ],
        },
        returnData: true,
    });
    const newFile = await databaseService.execute({
        ...updateQuery,
        env: getDatabaseEnv(normalizedEnv),
    });

    return newFile[0];
};

export const confirmSignedUploadUrls = async (
    access: StorageAccess,
    signedUploadUrls: string[],
    env: StorageEnv = 'current'
): Promise<StorageBatchConfirmUploadResult> => {
    const normalizedAccess = normalizeStorageAccess(access);
    const normalizedEnv = normalizeStorageEnv(env);

    const results = await promisePool(
        signedUploadUrls,
        async (signedUploadUrl): Promise<StorageBatchItemResult<unknown>> => {
            try {
                const result = await confirmSignedUploadUrl(normalizedAccess, signedUploadUrl, normalizedEnv);
                return { ok: true, value: result };
            } catch (error) {
                return { ok: false, failure: toStorageBatchFailure(error, { signedUploadUrl }) };
            }
        },
        STORAGE_BATCH_CONCURRENCY
    );

    const confirmed: StorageBatchConfirmUploadResult['confirmed'] = [];
    const failed: StorageBatchConfirmUploadResult['failed'] = [];
    for (const result of results) {
        if (result.ok === false) {
            failed.push(result.failure);
            continue;
        }
        confirmed.push(result.value);
    }

    return { confirmed, failed };
};

export const copy = async (
    access: StorageAccess,
    source: string,
    destination: string,
    options: StorageCopyMoveOptions = {},
    env: StorageEnv = 'current'
) => {
    const normalizedAccess = normalizeStorageAccess(access);
    const normalizedEnv = normalizeStorageEnv(env);
    const disk = getDisk(normalizedAccess, normalizedEnv);
    const sourceFile = await findFile(normalizedAccess, source, normalizedEnv);

    await assertObjectExists(disk, source);
    if (!options.overwrite) {
        await assertObjectDoesNotExist(disk, destination);
        await assertFileDoesNotExist(normalizedAccess, destination, normalizedEnv);
    }

    await disk.copy(source, destination, options);

    if (!sourceFile) return null;

    const metadata = await disk.getMetaData(destination);
    const upsertQuery = databaseService.getInsertQuery({
        schema: 'storage',
        table: ACCESS_TABLE_NAME[normalizedAccess],
        data: {
            ...getFileBaseData(destination),
            size: metadata.contentLength,
            type: metadata.contentType,
        },
        primaryColumn: 'path',
        returnData: true,
        upsert: true,
    });
    const result = await databaseService.execute({
        ...upsertQuery,
        env: getDatabaseEnv(normalizedEnv),
    });

    return result[0];
};

export const move = async (
    access: StorageAccess,
    source: string,
    destination: string,
    options: StorageCopyMoveOptions = {},
    env: StorageEnv = 'current'
) => {
    const normalizedAccess = normalizeStorageAccess(access);
    const normalizedEnv = normalizeStorageEnv(env);
    const disk = getDisk(normalizedAccess, normalizedEnv);
    const overwrite = Boolean(options.overwrite);
    let usedCopyFallback = false;
    const sourceFile = await findFile(normalizedAccess, source, normalizedEnv);

    await assertObjectExists(disk, source);
    if (!overwrite) {
        await assertObjectDoesNotExist(disk, destination);
        await assertFileDoesNotExist(normalizedAccess, destination, normalizedEnv);
    }

    try {
        await disk.move(source, destination, options);
    } catch (error) {
        if (!isUnsupportedOperationError(error)) throw error;
        if (overwrite) throw new StorageUnsupportedOperationError();
        await disk.copy(source, destination, options);
        usedCopyFallback = true;
    }

    try {
        if (!sourceFile) {
            if (usedCopyFallback) {
                await disk.delete(source);
            }
            return null;
        }

        const result = await updateMovedFileInDatabase(
            normalizedAccess,
            source,
            destination,
            overwrite,
            normalizedEnv
        );
        if (usedCopyFallback) {
            await disk.delete(source);
        }
        return result;
    } catch (error) {
        if (usedCopyFallback) {
            try {
                await disk.delete(destination);
            } catch (_cleanupError) {}
        }
        throw error;
    }
};

export const deletePath = async (access: StorageAccess, path: string, env: StorageEnv = 'current') => {
    const normalizedAccess = normalizeStorageAccess(access);
    const normalizedEnv = normalizeStorageEnv(env);
    const normalizedPath = normalizePath(path);
    const disk = getDisk(normalizedAccess, normalizedEnv);
    const file = await findFile(normalizedAccess, normalizedPath, normalizedEnv, { includePendingUpload: true });
    const objectExists = await disk.exists(normalizedPath);

    if (!file && !objectExists) throw new StorageNotFoundError();

    if (objectExists) await disk.delete(normalizedPath);
    await deleteFileFromDatabase(normalizedAccess, normalizedPath, normalizedEnv);
};

export const copyFiles = async (
    access: StorageAccess,
    files: StorageBatchMoveCopyFile[],
    env: StorageEnv = 'current'
): Promise<StorageBatchMoveCopyResult> => {
    const normalizedAccess = normalizeStorageAccess(access);
    const normalizedEnv = normalizeStorageEnv(env);
    const duplicateDestinations = getDuplicateNormalizedPaths(files.map(file => file.destination));

    const results = await promisePool(
        files,
        async (file): Promise<StorageBatchItemResult<StorageBatchMoveCopyResult['succeeded'][number]>> => {
            try {
                const normalizedDestination = normalizePath(file.destination, { catchError: true });
                if (normalizedDestination && duplicateDestinations.has(normalizedDestination)) {
                    throw new StorageConflictError('Duplicate destination path in request');
                }
                const result = await copy(
                    normalizedAccess,
                    file.source,
                    file.destination,
                    file.options || {},
                    normalizedEnv
                );
                return {
                    ok: true,
                    value: {
                        source: normalizePath(file.source),
                        destination: normalizePath(file.destination),
                        result,
                    },
                };
            } catch (error) {
                return {
                    ok: false,
                    failure: toStorageBatchFailure(error, {
                        source: normalizePath(file.source, { catchError: true }) || file.source,
                        destination: normalizePath(file.destination, { catchError: true }) || file.destination,
                    }),
                };
            }
        },
        STORAGE_BATCH_CONCURRENCY
    );

    const succeeded: StorageBatchMoveCopyResult['succeeded'] = [];
    const failed: StorageBatchMoveCopyResult['failed'] = [];
    for (const result of results) {
        if (result.ok === false) {
            failed.push(result.failure);
            continue;
        }
        succeeded.push(result.value);
    }

    return { total: files.length, succeeded, failed };
};

export const moveFiles = async (
    access: StorageAccess,
    files: StorageBatchMoveCopyFile[],
    env: StorageEnv = 'current'
): Promise<StorageBatchMoveCopyResult> => {
    const normalizedAccess = normalizeStorageAccess(access);
    const normalizedEnv = normalizeStorageEnv(env);
    const duplicateDestinations = getDuplicateNormalizedPaths(files.map(file => file.destination));

    const results = await promisePool(
        files,
        async (file): Promise<StorageBatchItemResult<StorageBatchMoveCopyResult['succeeded'][number]>> => {
            try {
                const normalizedDestination = normalizePath(file.destination, { catchError: true });
                if (normalizedDestination && duplicateDestinations.has(normalizedDestination)) {
                    throw new StorageConflictError('Duplicate destination path in request');
                }
                const result = await move(
                    normalizedAccess,
                    file.source,
                    file.destination,
                    file.options || {},
                    normalizedEnv
                );
                return {
                    ok: true,
                    value: {
                        source: normalizePath(file.source),
                        destination: normalizePath(file.destination),
                        result,
                    },
                };
            } catch (error) {
                return {
                    ok: false,
                    failure: toStorageBatchFailure(error, {
                        source: normalizePath(file.source, { catchError: true }) || file.source,
                        destination: normalizePath(file.destination, { catchError: true }) || file.destination,
                    }),
                };
            }
        },
        STORAGE_BATCH_CONCURRENCY
    );

    const succeeded: StorageBatchMoveCopyResult['succeeded'] = [];
    const failed: StorageBatchMoveCopyResult['failed'] = [];
    for (const result of results) {
        if (result.ok === false) {
            failed.push(result.failure);
            continue;
        }
        succeeded.push(result.value);
    }

    return { total: files.length, succeeded, failed };
};

export const deletePaths = async (
    access: StorageAccess,
    paths: string[],
    env: StorageEnv = 'current'
): Promise<StorageBatchDeleteResult> => {
    const normalizedAccess = normalizeStorageAccess(access);
    const normalizedEnv = normalizeStorageEnv(env);

    const results = await promisePool(
        paths,
        async (path): Promise<StorageBatchItemResult<string>> => {
            try {
                await deletePath(normalizedAccess, path, normalizedEnv);
                return { ok: true, value: normalizePath(path) };
            } catch (error) {
                return {
                    ok: false,
                    failure: toStorageBatchFailure(error, { path: normalizePath(path, { catchError: true }) || path }),
                };
            }
        },
        STORAGE_BATCH_CONCURRENCY
    );

    const deleted: string[] = [];
    const failed: StorageBatchDeleteResult['failed'] = [];
    for (const result of results) {
        if (result.ok === false) {
            failed.push(result.failure);
            continue;
        }
        deleted.push(result.value);
    }

    return { total: paths.length, deleted, failed };
};

export const listFilesInFolder = async (
    access: StorageAccess,
    prefix: string,
    env: StorageEnv = 'current'
) => {
    const normalizedAccess = normalizeStorageAccess(access);
    const normalizedEnv = normalizeStorageEnv(env);
    const normalizedPrefix = normalizeFolderPrefix(prefix);
    const disk = getDisk(normalizedAccess, normalizedEnv);
    const files: string[] = [];
    let paginationToken: string | undefined;

    do {
        const result = await disk.listAll(normalizedPrefix, { recursive: true, paginationToken });

        for (const object of Array.from(result.objects)) {
            if (!object.isFile) continue;
            const normalizedPath = normalizePath(object.key, { catchError: true });
            if (!normalizedPath) continue;
            files.push(normalizedPath);
        }

        paginationToken = result.paginationToken;
    } while (paginationToken);

    return files;
};

export const moveFolder = async (
    access: StorageAccess,
    sourcePrefix: string,
    destinationPrefix: string,
    options: StorageCopyMoveOptions = {},
    env: StorageEnv = 'current'
): Promise<StorageFolderOperationResult> => {
    const normalizedSourcePrefix = normalizeFolderPrefix(sourcePrefix);
    const normalizedDestinationPrefix = normalizeFolderPrefix(destinationPrefix);

    if (!normalizedSourcePrefix) throw new StorageUnsupportedOperationError('Cannot move the storage root folder');
    if (!normalizedDestinationPrefix) {
        throw new StorageUnsupportedOperationError('Destination folder is required');
    }
    if (normalizedDestinationPrefix === normalizedSourcePrefix) {
        throw new StorageConflictError('Destination folder must be different from the source folder');
    }
    if (normalizedDestinationPrefix.startsWith(`${normalizedSourcePrefix}/`)) {
        throw new StorageConflictError('Destination folder cannot be inside the source folder');
    }

    const files = await listFilesInFolder(access, normalizedSourcePrefix, env);
    const batchResult = await moveFiles(
        access,
        files.map(source => ({
            source,
            destination: getPathInFolder(source, normalizedSourcePrefix, normalizedDestinationPrefix),
            options,
        })),
        env
    );

    return {
        total: batchResult.total,
        succeeded: batchResult.succeeded.map(item => item.source),
        failed: batchResult.failed.map(item => ({
            source: item.source || '',
            destination: item.destination,
            message: item.message,
        })),
    };
};

export const deleteFolder = async (
    access: StorageAccess,
    prefix: string,
    env: StorageEnv = 'current'
): Promise<StorageFolderOperationResult> => {
    const normalizedPrefix = normalizeFolderPrefix(prefix);

    if (!normalizedPrefix) throw new StorageUnsupportedOperationError('Cannot delete the storage root folder');

    const files = await listFilesInFolder(access, normalizedPrefix, env);
    const batchResult = await deletePaths(access, files, env);

    return {
        total: batchResult.total,
        succeeded: batchResult.deleted,
        failed: batchResult.failed.map(item => ({
            source: item.path || '',
            message: item.message,
        })),
    };
};

async function copyStorageEnvironmentFile(
    row: StorageFileRow,
    sourceDisk: Disk,
    targetDisk: Disk,
    summary: StorageEnvironmentCopyAccessSummary
) {
    const path = normalizePath(row.path);

    try {
        if (await targetDisk.exists(path)) {
            summary.skippedExisting += 1;
            return;
        }

        if (!(await sourceDisk.exists(path))) {
            summary.missingSource += 1;
            return;
        }

        let metadata: ObjectMetaData | null = null;
        try {
            metadata = await sourceDisk.getMetaData(path);
        } catch (_error) {}

        const stream = await sourceDisk.getStream(path);
        await targetDisk.putStream(path, stream, getStorageWriteOptions(metadata, row));
        summary.copied += 1;
    } catch (error) {
        addStorageEnvironmentCopyFailure(summary, path, error);
    }
}

async function failStorageEnvironmentCopyAccess(
    access: StorageAccess,
    env: StorageEnv,
    summary: StorageEnvironmentCopyAccessSummary,
    error: unknown
) {
    const total = await getStorageEnvironmentFileCount(access, env);
    summary.total = total ?? 0;
    summary.failed = summary.total;
    if (summary.total) {
        summary.failures.push(toStorageBatchFailure(error, { path: '*' }));
    }
}

async function copyStorageEnvironmentAccess(
    access: StorageAccess,
    sourceEnv: StorageEnv,
    targetEnv: StorageEnv,
    options: Required<StorageEnvironmentCopyOptions>
) {
    const summary = createStorageEnvironmentCopyAccessSummary();
    const total = await getStorageEnvironmentFileCount(access, targetEnv);
    if (total === null) return summary;

    summary.total = total;
    if (!summary.total) return summary;

    let sourceDisk: Disk;
    let targetDisk: Disk;
    try {
        sourceDisk = getDisk(access, sourceEnv);
        targetDisk = getDisk(access, targetEnv);
    } catch (error) {
        await failStorageEnvironmentCopyAccess(access, targetEnv, summary, error);
        return summary;
    }

    for (let offset = 0; offset < summary.total; offset += options.batchSize) {
        const rows = await getStorageEnvironmentFileRows(access, targetEnv, options.batchSize, offset);
        await promisePool(
            rows,
            row => copyStorageEnvironmentFile(row, sourceDisk, targetDisk, summary),
            options.concurrency
        );
    }

    return summary;
}

export const copyEnvironment = async (
    sourceEnv: StorageEnv,
    targetEnv: StorageEnv,
    options: StorageEnvironmentCopyOptions = {}
): Promise<StorageEnvironmentCopySummary> => {
    const normalizedSourceEnv = normalizeStorageEnv(sourceEnv);
    const normalizedTargetEnv = normalizeStorageEnv(targetEnv);
    if (normalizedSourceEnv === normalizedTargetEnv) {
        throw new Error('Source and target environments cannot be the same');
    }

    const normalizedOptions = {
        batchSize: normalizePositiveInteger(options.batchSize, STORAGE_ENVIRONMENT_COPY_BATCH_SIZE),
        concurrency: normalizePositiveInteger(options.concurrency, STORAGE_BATCH_CONCURRENCY),
    };

    return {
        sourceEnv: normalizedSourceEnv,
        targetEnv: normalizedTargetEnv,
        public: await copyStorageEnvironmentAccess('public', normalizedSourceEnv, normalizedTargetEnv, normalizedOptions),
        private: await copyStorageEnvironmentAccess(
            'private',
            normalizedSourceEnv,
            normalizedTargetEnv,
            normalizedOptions
        ),
    };
};

const driverInstances = new Map<string, DriverContract>();
const editorDriverInstances = new WeakMap<EditorRuntime, Map<string, DriverContract>>();

// Must stay synchronous: the public-URL service reads the bucket region from here, and it is
// reached from a formula.
export function resolveStorageConnectionConfig(
    access: StorageAccess,
    runtimeConfig: StorageRuntimeConfig
): ConnectionConfig | null {
    if (
        !runtimeConfig.connectionId &&
        runtimeConfig.integration !== 'weweb-storage' &&
        runtimeConfig.integration !== 'aws-s3' &&
        runtimeConfig.integration !== 's3-compatible' &&
        runtimeConfig.integration !== 'cloudflare'
    ) {
        return null;
    }

    const connection = runtimeConfig.connectionId ? getConnections()[runtimeConfig.connectionId] : null;
    if (runtimeConfig.connectionId && !connection) return null;

    return (
        connection
            ? resolveConnectionConfig(connection.config, {
                  env: runtimeConfig.env,
              })
            : resolveSelfHostedStorageConnection(access, runtimeConfig) ?? {}
    ) as ConnectionConfig;
}

function getDriver(access: StorageAccess, env: StorageEnv = 'current') {
    const normalizedAccess = normalizeStorageAccess(access);
    const normalizedEnv = normalizeStorageEnv(env);
    const cacheKey = `${normalizedEnv}:${normalizedAccess}`;
    const runtime = getEditorRuntime();
    if (runtime && !editorDriverInstances.has(runtime)) editorDriverInstances.set(runtime, new Map());
    const instances = runtime ? editorDriverInstances.get(runtime)! : driverInstances;

    if (instances.has(cacheKey)) return instances.get(cacheKey);

    const runtimeConfig = resolveStorageRuntimeConfig(normalizedEnv);
    if (!runtimeConfig.integration) return null;

    const resolvedConnectionConfig = resolveStorageConnectionConfig(normalizedAccess, runtimeConfig);
    if (!resolvedConnectionConfig) return null;

    const storageDriverFactory = getStorageDriver(runtimeConfig.integration);
    if (!storageDriverFactory) return null;
    const driver = storageDriverFactory(normalizedAccess, resolvedConnectionConfig, runtimeConfig);

    if (!driver) return null;

    instances.set(cacheKey, driver);
    return driver;
}

export function getDisk(access: StorageAccess, env: StorageEnv = 'current') {
    const driver = getDriver(access, env);
    if (!driver) throw new Error('No storage driver configured');
    return new Disk(driver);
}

export default {
    ACCESS_TABLE_NAME,
    normalizePath,
    normalizeStorageAccess,
    normalizeStorageEnv,
    getFileBaseData,
    get,
    getBytes,
    put,
    getSignedUrl,
    getSignedUploadUrl,
    getSignedUploadUrls,
    confirmSignedUploadUrl,
    confirmSignedUploadUrls,
    findFilesByPath,
    copyEnvironment,
    copy,
    copyFiles,
    move,
    moveFiles,
    moveFolder,
    deletePaths,
    deleteFolder,
    listFilesInFolder,
    delete: deletePath,
    getDisk,
};
