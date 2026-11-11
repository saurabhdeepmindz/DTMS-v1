import type { Context as HonoContext } from 'hono';
import { HTTPException } from 'hono/http-exception';
import storageCore, { type StorageAccess, type StorageEnv } from '../../core/storage.core.ts';
import { StorageError, normalizeStorageError } from '../../core/storage.errors.ts';
import { PublicHTTPException } from '../../core/http.errors.ts';
import databaseService from '../../services/database/database.service.ts';
import { promisePool } from '../../utils/promisePool.ts';

type StorageRouteOptions = Record<string, unknown>;

type StorageDbFile = {
    path: string;
    name: string;
    prefix?: string;
    ext: string;
    type: string;
    size: number;
    updatedAt?: string | Date;
};
type StorageListItem =
    | {
          isDirectory: true;
          name: string;
      }
    | {
          isFile: true;
          path: string;
          name?: string;
          ext?: string;
          type?: string;
          size?: number;
          updatedAt?: string | Date;
          isSynced: boolean;
      };

type MoveCopyBody = {
    source: string;
    destination: string;
    options?: StorageRouteOptions;
};

type BatchMoveCopyBody = {
    files?: MoveCopyBody[];
};

type CopyEnvironmentBody = {
    sourceEnv?: string;
    targetEnv?: string;
};

type SignedUrlBody = {
    path: string;
    options?: StorageRouteOptions;
};

type BatchSignedUploadUrlBody = {
    files?: SignedUrlBody[];
};

type BatchConfirmSignedUploadUrlBody = {
    signedUploadUrls?: string[];
};

type DeleteFilesBody = {
    paths?: string[];
};

type FolderBody = {
    prefix?: string;
    sourcePrefix?: string;
    destinationPrefix?: string;
    options?: StorageRouteOptions;
};

type ConfirmSignedUploadUrlBody = {
    signedUploadUrl?: string;
};

type PendingSignedUploadFile = {
    access: StorageAccess;
    path: string;
};

const STORAGE_LIST_METADATA_CONCURRENCY = 8;

function isStorageListItem(item: StorageListItem | null): item is StorageListItem {
    return item !== null;
}

function getStorageAccess(c: HonoContext) {
    const access = c.req.param('access');
    try {
        return storageCore.normalizeStorageAccess(access);
    } catch (_error) {
        throw new HTTPException(400, { message: 'Invalid storage access' });
    }
}

function getStorageEnv(c: HonoContext) {
    const env = c.req.param('env') || 'current';
    try {
        return storageCore.normalizeStorageEnv(env);
    } catch (_error) {
        throw new HTTPException(400, { message: 'Invalid storage environment' });
    }
}

function getStorageEnvironment(env: unknown) {
    if (typeof env !== 'string') {
        throw new HTTPException(400, { message: 'Invalid storage environment' });
    }

    try {
        const normalizedEnv = storageCore.normalizeStorageEnv(env);
        if (normalizedEnv === 'current') {
            throw new Error('Invalid storage environment');
        }
        return normalizedEnv;
    } catch (_error) {
        throw new HTTPException(400, { message: 'Invalid storage environment' });
    }
}

function getDatabaseEnv(env: string) {
    if (env === 'current') return null;
    return env;
}

function toStorageHttpException(error: unknown) {
    error = normalizeStorageError(error);
    if (error instanceof HTTPException) return error;
    if (error instanceof StorageError) {
        return new PublicHTTPException(error.status, error.message, { code: error.code });
    }
    return new HTTPException(500, { message: String((error as Error)?.message || 'Internal Server Error') });
}

async function findPendingSignedUploadFile(signedUploadUrl: string, env: string): Promise<PendingSignedUploadFile | null> {
    const accesses = Object.keys(storageCore.ACCESS_TABLE_NAME) as StorageAccess[];

    for (const access of accesses) {
        const selectQuery = databaseService.getSelectQuery({
            schema: 'storage',
            table: storageCore.ACCESS_TABLE_NAME[access],
            columns: { path: true },
            filters: {
                link: '$and',
                conditions: [{ field: 'signedUploadUrl', operator: '$eq', value: signedUploadUrl }],
            },
            limit: 1,
        });
        const rows = (await databaseService.execute({
            ...selectQuery,
            env: getDatabaseEnv(env),
        })) as { path: string }[];

        if (!rows.length) continue;

        return { access, path: rows[0].path };
    }

    return null;
}

export const confirmSignedUploadUrl = async (c: HonoContext) => {
    const env = getStorageEnv(c);
    const { signedUploadUrl } = (await c.req.json()) as ConfirmSignedUploadUrlBody;
    if (!signedUploadUrl) throw new HTTPException(400, { message: 'Invalid signed upload URL' });

    const pendingFile = await findPendingSignedUploadFile(signedUploadUrl, env);
    if (!pendingFile) throw new HTTPException(404, { message: 'Signed upload URL not found' });

    const { access } = pendingFile;

    const newFile = await storageCore.confirmSignedUploadUrl(access, signedUploadUrl, env);

    return c.json(newFile, 200);
};

export const listAll = async (c: HonoContext) => {
    const access = getStorageAccess(c);
    const env = getStorageEnv(c);
    const prefix = c.req.query('prefix') || '';
    const paginationToken = c.req.query('paginationToken') || c.req.query('offset') || null;
    const recursive = c.req.query('recursive');
    const maxResults = c.req.query('maxResults');
    const options: StorageRouteOptions = {};

    if (paginationToken) options.paginationToken = paginationToken;
    if (recursive !== undefined) options.recursive = recursive !== 'false';
    if (maxResults !== undefined) {
        const parsedMaxResults = Number(maxResults);
        if (Number.isFinite(parsedMaxResults) && parsedMaxResults > 0) {
            options.maxResults = parsedMaxResults;
        }
    }

    const disk = storageCore.getDisk(access, env);

    const result = await disk.listAll(prefix, options);
    const objects = Array.from(result.objects);

    const normalizedPrefix = storageCore.normalizePath(prefix, { catchError: true });
    const filePaths: string[] = [];
    for (const object of objects) {
        if (!object.isFile || !('key' in object)) continue;
        const normalizedPath = storageCore.normalizePath(object.key, { catchError: true });
        if (normalizedPath) filePaths.push(normalizedPath);
    }
    const dbFilesByPath = await storageCore.findFilesByPath<StorageDbFile>(access, filePaths, env, {
        path: true,
        name: true,
        prefix: true,
        ext: true,
        type: true,
        size: true,
        updatedAt: true,
    });

    const items = (
        await promisePool(
            objects,
            async (object): Promise<StorageListItem | null> => {
                if (object.isDirectory) {
                    return {
                        isDirectory: true,
                        name: object.name,
                    };
                }

                if (!object.isFile || !('key' in object)) return null;

                const normalizedPath = storageCore.normalizePath(object.key);
                const existingFile = dbFilesByPath.get(normalizedPath);
                if (existingFile) {
                    return {
                        isFile: true,
                        path: existingFile.path,
                        name: existingFile.name,
                        ext: existingFile.ext,
                        type: existingFile.type,
                        size: existingFile.size,
                        updatedAt: existingFile.updatedAt,
                        isSynced: true,
                    };
                }

                const metadata = await disk.getMetaData(object.key);
                return {
                    isFile: true,
                    ...storageCore.getFileBaseData(normalizedPath),
                    type: metadata.contentType,
                    size: metadata.contentLength,
                    updatedAt: metadata.lastModified,
                    isSynced: false,
                };
            },
            STORAGE_LIST_METADATA_CONCURRENCY
        )
    ).filter(isStorageListItem);

    return c.json(
        {
            prefix: normalizedPrefix,
            items,
            nextToken: result.paginationToken,
            offset: result.paginationToken,
        },
        200
    );
};

export const move = async (c: HonoContext) => {
    const access = getStorageAccess(c);
    const env = getStorageEnv(c);
    const { source, destination, options = {} } = (await c.req.json()) as MoveCopyBody;
    try {
        const result = await storageCore.move(access, source, destination, options, env);
        return c.json(result, 200);
    } catch (error) {
        throw toStorageHttpException(error);
    }
};

export const copy = async (c: HonoContext) => {
    const access = getStorageAccess(c);
    const env = getStorageEnv(c);
    const { source, destination, options = {} } = (await c.req.json()) as MoveCopyBody;
    try {
        const result = await storageCore.copy(access, source, destination, options, env);
        return c.json(result, 200);
    } catch (error) {
        throw toStorageHttpException(error);
    }
};

export const copyEnvironment = async (c: HonoContext) => {
    const { sourceEnv, targetEnv } = (await c.req.json()) as CopyEnvironmentBody;
    const normalizedSourceEnv = getStorageEnvironment(sourceEnv) as StorageEnv;
    const normalizedTargetEnv = getStorageEnvironment(targetEnv) as StorageEnv;

    if (normalizedSourceEnv === normalizedTargetEnv) {
        throw new HTTPException(400, { message: 'Source and target environments cannot be the same' });
    }

    try {
        const result = await storageCore.copyEnvironment(normalizedSourceEnv, normalizedTargetEnv);
        return c.json(result, 200);
    } catch (error) {
        throw toStorageHttpException(error);
    }
};

export const copyList = async (c: HonoContext) => {
    const access = getStorageAccess(c);
    const env = getStorageEnv(c);
    const { files = [] } = (await c.req.json()) as BatchMoveCopyBody;
    if (!Array.isArray(files)) throw new HTTPException(400, { message: 'Invalid files list' });

    const result = await storageCore.copyFiles(access, files, env);
    return c.json(result, 200);
};

export const moveList = async (c: HonoContext) => {
    const access = getStorageAccess(c);
    const env = getStorageEnv(c);
    const { files = [] } = (await c.req.json()) as BatchMoveCopyBody;
    if (!Array.isArray(files)) throw new HTTPException(400, { message: 'Invalid files list' });

    const result = await storageCore.moveFiles(access, files, env);
    return c.json(result, 200);
};

export const deleteList = async (c: HonoContext) => {
    const access = getStorageAccess(c);
    const env = getStorageEnv(c);
    const { paths = [] } = (await c.req.json()) as DeleteFilesBody;
    if (!Array.isArray(paths)) throw new HTTPException(400, { message: 'Invalid paths list' });

    const result = await storageCore.deletePaths(access, paths, env);

    return c.json({ deleted: result.deleted, failed: result.failed.map(item => item.path || '') }, 200);
};

export const deleteBatch = async (c: HonoContext) => {
    const access = getStorageAccess(c);
    const env = getStorageEnv(c);
    const { paths = [] } = (await c.req.json()) as DeleteFilesBody;
    if (!Array.isArray(paths)) throw new HTTPException(400, { message: 'Invalid paths list' });

    const result = await storageCore.deletePaths(access, paths, env);
    return c.json(result, 200);
};

export const getSignedUrl = async (c: HonoContext) => {
    const access = getStorageAccess(c);
    const env = getStorageEnv(c);
    const { path, options = {} } = (await c.req.json()) as SignedUrlBody;

    const result = await storageCore.getSignedUrl(access, path, options, env);

    return c.json(result, 200);
};

export const getSignedUploadUrl = async (c: HonoContext) => {
    const access = getStorageAccess(c);
    const env = getStorageEnv(c);
    const { path, options = {} } = (await c.req.json()) as SignedUrlBody;

    const result = await storageCore.getSignedUploadUrl(access, path, options, env);

    return c.json(result, 200);
};

export const getSignedUploadUrls = async (c: HonoContext) => {
    const access = getStorageAccess(c);
    const env = getStorageEnv(c);
    const { files = [] } = (await c.req.json()) as BatchSignedUploadUrlBody;
    if (!Array.isArray(files)) throw new HTTPException(400, { message: 'Invalid files list' });

    const result = await storageCore.getSignedUploadUrls(access, files, env);
    return c.json(result, 200);
};

export const confirmSignedUploadUrls = async (c: HonoContext) => {
    const access = getStorageAccess(c);
    const env = getStorageEnv(c);
    const { signedUploadUrls = [] } = (await c.req.json()) as BatchConfirmSignedUploadUrlBody;
    if (!Array.isArray(signedUploadUrls)) {
        throw new HTTPException(400, { message: 'Invalid signed upload URLs list' });
    }

    const result = await storageCore.confirmSignedUploadUrls(access, signedUploadUrls, env);
    return c.json(result, 200);
};

export const countFolderFiles = async (c: HonoContext) => {
    const access = getStorageAccess(c);
    const env = getStorageEnv(c);
    const prefix = c.req.query('prefix') || '';
    const files = await storageCore.listFilesInFolder(access, prefix, env);

    return c.json({ prefix: storageCore.normalizePath(prefix, { catchError: true }), count: files.length }, 200);
};

export const moveFolder = async (c: HonoContext) => {
    const access = getStorageAccess(c);
    const env = getStorageEnv(c);
    const { sourcePrefix, destinationPrefix, options = {} } = (await c.req.json()) as FolderBody;

    try {
        const result = await storageCore.moveFolder(access, sourcePrefix || '', destinationPrefix || '', options, env);
        return c.json(result, 200);
    } catch (error) {
        throw toStorageHttpException(error);
    }
};

export const deleteFolder = async (c: HonoContext) => {
    const access = getStorageAccess(c);
    const env = getStorageEnv(c);
    const { prefix } = (await c.req.json()) as FolderBody;

    try {
        const result = await storageCore.deleteFolder(access, prefix || '', env);
        return c.json(result, 200);
    } catch (error) {
        throw toStorageHttpException(error);
    }
};

export const syncFile = async (c: HonoContext) => {
    const access = getStorageAccess(c);
    const env = getStorageEnv(c);
    const { path } = await c.req.json();

    const disk = storageCore.getDisk(access, env);

    if (!(await disk.exists(path))) throw new HTTPException(404);
    const metadata = await disk.getMetaData(path);

    const normalizedPath = storageCore.normalizePath(path);
    const updateQuery = databaseService.getInsertQuery({
        schema: 'storage',
        table: storageCore.ACCESS_TABLE_NAME[access],
        data: {
            ...storageCore.getFileBaseData(normalizedPath),
            type: metadata.contentType,
            size: metadata.contentLength,
            signedUploadUrl: null,
            signedUploadUrlExpiresAt: null,
        },
        primaryColumn: 'path',
        upsert: true,
    });
    await databaseService.execute({
        ...updateQuery,
        env: getDatabaseEnv(env),
    });

    return c.json({}, 200);
};
