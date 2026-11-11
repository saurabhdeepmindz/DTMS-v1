import { Readable } from 'node:stream';
import { DriveFile, DriveDirectory, KeyNormalizer } from 'flydrive';
import type { WriteOptions, DriverContract, ObjectMetaData, ObjectVisibility, SignedURLOptions } from 'flydrive/types';
import { signLambdaUrlRequest } from '../../services/awsLambdaUrlSigning.service.ts';
import { registerStorageDriver } from '../../services/storageDriverRegistry.service.ts';

export class WeWebDriver implements DriverContract {
    cdnUrl: string;
    visibility?: ObjectVisibility;
    proxyUrl: string;
    projectId: string;
    env: string;
    access: string;
    keyPrefix: string;
    normalizer: KeyNormalizer;

    constructor(config: {
        cdnUrl: string;
        visibility?: ObjectVisibility;
        proxyUrl?: string;
        projectId?: string;
        env?: string;
        access: string;
        keyPrefix?: string;
    }) {
        this.cdnUrl = config.cdnUrl;
        this.visibility = config.visibility;
        this.proxyUrl = config.proxyUrl;
        this.projectId = config.projectId;
        this.env = resolveStorageEnv(config.env);
        this.access = config.access;
        this.keyPrefix = normalizePathPrefix(config.keyPrefix);
        this.normalizer = new KeyNormalizer();
    }
    /**
     * Return a boolean value indicating if the file exists
     * or not.
     */
    async exists(key: string): Promise<boolean> {
        const normalizedKey = this.normalizeKey(key);

        try {
            const response = await this.request('exists', { key: this.toProxyKey(normalizedKey) });
            if (typeof response?.exists === 'boolean') return response.exists;
            return true;
        } catch (error) {
            if (isUnsupportedOperationError(error)) {
                try {
                    await this.getMetaData(normalizedKey);
                    return true;
                } catch (metadataError) {
                    if (isNotFoundError(metadataError)) return false;
                    throw metadataError;
                }
            }
            if (isNotFoundError(error)) return false;
            throw error;
        }
    }

    /**
     * Return the file contents as a UTF-8 string. Throw an exception
     * if the file is missing.
     */
    async get(key: string): Promise<string> {
        const bytes = await this.getBytes(key);
        return Buffer.from(bytes).toString('utf8');
    }

    /**
     * Return the file contents as a Readable stream. Throw an exception
     * if the file is missing.
     */
    async getStream(key: string): Promise<Readable> {
        const bytes = await this.getBytes(key);
        return Readable.from(bytes);
    }

    /**
     * Return the file contents as a Uint8Array. Throw an exception
     * if the file is missing.
     */
    async getBytes(key: string): Promise<Uint8Array> {
        const signedUrl = await this.getSignedUrl(key, { expiresIn: 60 });
        const response = await fetch(signedUrl, { method: 'GET' });
        if (!response.ok) throw new Error(`Failed to download file (${response.status})`);
        return new Uint8Array(await response.arrayBuffer());
    }

    /**
     * Return metadata of the file. Throw an exception
     * if the file is missing.
     */
    async getMetaData(key: string): Promise<ObjectMetaData> {
        const normalizedKey = this.normalizeKey(key);

        try {
            const response = await this.request('metadata', { key: this.toProxyKey(normalizedKey) });
            if (response?.metadata) return this.toMetadata(response.metadata);
        } catch (error) {
            if (!isUnsupportedOperationError(error)) throw error;
        }

        const response = await this.request('list', {
            prefix: this.toProxyPrefix(normalizedKey),
            options: { recursive: true, maxResults: 1000 },
        });
        const objects = Array.isArray(response?.objects) ? response.objects : [];
        for (const object of objects) {
            const objectKey = this.fromProxyKey(object?.key || '');
            if (objectKey === normalizedKey) {
                return this.toMetadata(object);
            }
        }

        throw new Error('File not found');
    }

    /**
     * Return visibility of the file. Infer visibility from the initial
     * config, when the driver does not support the concept of visibility.
     */
    async getVisibility(key: string): Promise<ObjectVisibility> {
        return this.visibility || 'private';
    }

    /**
     * Return the public URL of the file. Throw an exception when the driver
     * does not support generating URLs.
     */
    async getUrl(key: string): Promise<string> {
        return await this.getSignedUrl(key, { expiresIn: 3600 });
    }

    /**
     * Return the signed URL to serve a private file. Throw exception
     * when the driver does not support generating URLs.
     */
    async getSignedUrl(key: string, options?: SignedURLOptions): Promise<string> {
        const normalizedKey = this.normalizeKey(key);
        const response = await this.request('get', {
            key: this.toProxyKey(normalizedKey),
            // The storage proxy applies the real limit (7 days through CloudFront)
            expiresIn: normalizeExpiresIn(options?.expiresIn, MAX_DOWNLOAD_EXPIRES_IN),
            contentType: options?.contentType,
            contentDisposition: options?.contentDisposition,
        });
        const signedUrl = response?.presignedUrl || response?.signedUrl || response?.url;
        if (!signedUrl) throw new Error('Storage proxy did not return a signed URL');
        return signedUrl;
    }

    /**
     *
     */
    async getSignedUploadUrl(key: string, options?: SignedURLOptions): Promise<string> {
        const normalizedKey = this.normalizeKey(key);
        const contentLength = normalizePositiveNumber(options?.contentLength || options?.contentSize || options?.size);
        const response = await this.request('put', {
            key: this.toProxyKey(normalizedKey),
            expiresIn: normalizeExpiresIn(options?.expiresIn),
            contentType: options?.contentType,
            size: contentLength,
        });
        const signedUrl = response?.presignedUrl || response?.signedUrl || response?.url;
        if (!signedUrl) throw new Error('Storage proxy did not return a signed upload URL');
        return signedUrl;
    }

    /**
     * Update the visibility of the file. Result in a NOOP
     * when the driver does not support the concept of
     * visibility.
     */
    async setVisibility(key: string, visibility: ObjectVisibility): Promise<void> {}

    /**
     * Create a new file or update an existing file. The contents
     * will be a UTF-8 string or "Uint8Array".
     */
    async put(key: string, contents: string | Uint8Array, options?: WriteOptions): Promise<void> {
        const contentType = options?.contentType || 'application/octet-stream';
        const contentLength =
            options?.contentLength ||
            (typeof contents === 'string' ? Buffer.byteLength(contents) : contents.byteLength);

        const signedUploadUrl = await this.getSignedUploadUrl(key, {
            expiresIn: options?.expiresIn,
            contentType,
            contentLength,
        });
        const headers = {};
        headers['content-type'] = contentType;
        headers['content-length'] = String(contentLength);
        const response = await fetch(signedUploadUrl, {
            method: 'PUT',
            headers,
            body: typeof contents === 'string' ? contents : Buffer.from(contents),
        });
        if (!response.ok) throw new Error(`Failed to upload file (${response.status})`);
    }

    /**
     * Create a new file or update an existing file. The contents
     * will be a Readable stream.
     */
    async putStream(key: string, contents: Readable, options?: WriteOptions): Promise<void> {
        const bytes = await streamToUint8Array(contents);
        await this.put(key, bytes, options);
    }

    /**
     * Copy the existing file to the destination. Make sure the new file
     * has the same visibility as the existing file. It might require
     * manually fetching the visibility of the "source" file.
     */
    async copy(source: string, destination: string, options?: WriteOptions): Promise<void> {
        const sourceKey = this.toProxyKey(this.normalizeKey(source));
        const destinationKey = this.toProxyKey(this.normalizeKey(destination));
        await this.request('copy', {
            key: sourceKey,
            destinationKey,
        });
    }

    /**
     * Move the existing file to the destination. Make sure the new file
     * has the same visibility as the existing file. It might require
     * manually fetching the visibility of the "source" file.
     */
    async move(source: string, destination: string, _options?: WriteOptions): Promise<void> {
        const sourceKey = this.toProxyKey(this.normalizeKey(source));
        const destinationKey = this.toProxyKey(this.normalizeKey(destination));
        await this.request('move', {
            key: sourceKey,
            destinationKey,
        });
    }

    /**
     * Delete an existing file. Do not throw an error if the
     * file is already missing
     */
    async delete(key: string): Promise<void> {
        const normalizedKey = this.normalizeKey(key);
        try {
            await this.request('delete', {
                key: this.toProxyKey(normalizedKey),
            });
        } catch (error) {
            if (isNotFoundError(error)) return;
            throw error;
        }
    }

    /**
     * Delete all files inside a folder. Do not throw an error
     * if the folder does not exist or is empty.
     */
    async deleteAll(prefix: string): Promise<void> {
        const result = await this.listAll(prefix, { recursive: true });
        for (const object of result.objects) {
            if (!object.isFile) continue;
            await this.delete(object.key);
        }
    }

    /**
     * List all files from a given folder or the root of the storage.
     * Do not throw an error if the request folder does not exist.
     */
    async listAll(
        prefix: string,
        options?: {
            recursive?: boolean;
            paginationToken?: string;
            maxResults?: number;
        }
    ): Promise<{
        paginationToken?: string;
        objects: Iterable<DriveFile | DriveDirectory>;
    }> {
        const normalizedPrefix = this.normalizePrefix(prefix);
        const recursive = options?.recursive !== false;
        const response = await this.request('list', {
            prefix: this.toProxyPrefix(normalizedPrefix),
            options: {
                recursive,
                paginationToken: options?.paginationToken,
                maxResults: options?.maxResults,
            },
        });
        const files = Array.isArray(response?.objects) ? response.objects : [];

        const objects = [];
        if (recursive) {
            for (const file of files) {
                const key = this.fromProxyKey(file?.key || '');
                if (!key) continue;
                objects.push(new DriveFile(key, this, this.toMetadata(file)));
            }
        } else {
            const seenDirectories = new Set<string>();
            const basePrefix = normalizedPrefix ? `${normalizedPrefix}/` : '';
            for (const file of files) {
                const key = this.fromProxyKey(file?.key || '');
                if (!key) continue;
                const relativeKey = basePrefix && key.startsWith(basePrefix) ? key.slice(basePrefix.length) : key;
                const nextSlash = relativeKey.indexOf('/');
                if (nextSlash === -1) {
                    objects.push(new DriveFile(key, this, this.toMetadata(file)));
                    continue;
                }
                const firstSegment = relativeKey.slice(0, nextSlash);
                const directoryPrefix = basePrefix ? `${basePrefix}${firstSegment}` : firstSegment;
                if (seenDirectories.has(directoryPrefix)) continue;
                seenDirectories.add(directoryPrefix);
                objects.push(new DriveDirectory(directoryPrefix));
            }
        }

        return {
            paginationToken: response?.paginationToken || response?.nextToken,
            objects: {
                [Symbol.iterator]: function* () {
                    for (const object of objects) {
                        yield object;
                    }
                },
            },
        };
    }

    bucket(bucket: string): DriverContract {
        return this;
    }

    private normalizeKey(key: string): string {
        return this.normalizer.normalize(key);
    }

    private normalizePrefix(prefix: string): string {
        if (!prefix || prefix === '/') return '';
        return this.normalizer.normalize(prefix);
    }

    private toProxyKey(key: string): string {
        const normalizedKey = key || '';
        if (!this.keyPrefix) return normalizedKey;
        if (!normalizedKey) return this.keyPrefix;
        if (normalizedKey.startsWith(`${this.keyPrefix}/`)) return normalizedKey;
        return `${this.keyPrefix}/${normalizedKey}`;
    }

    private toProxyPrefix(prefix: string): string {
        const normalizedPrefix = prefix || '';
        if (!this.keyPrefix) return normalizedPrefix;
        if (!normalizedPrefix) return `${this.keyPrefix}/`;
        if (normalizedPrefix.startsWith(`${this.keyPrefix}/`)) return normalizedPrefix;
        return `${this.keyPrefix}/${normalizedPrefix}`;
    }

    private fromProxyKey(key: string): string {
        const normalizedKey = key || '';
        if (!this.keyPrefix) return normalizedKey;
        if (normalizedKey === this.keyPrefix) return '';
        if (normalizedKey.startsWith(`${this.keyPrefix}/`)) {
            return normalizedKey.slice(this.keyPrefix.length + 1);
        }
        return normalizedKey;
    }

    private toMetadata(metadata: any): ObjectMetaData {
        const contentLength = normalizePositiveNumber(metadata?.contentLength ?? metadata?.size) || 0;
        const etag = metadata?.etag || '';
        const lastModifiedValue = metadata?.lastModified || metadata?.last_modified;
        const lastModified = lastModifiedValue ? new Date(lastModifiedValue) : new Date();
        const contentType = metadata?.contentType || null;
        return {
            contentType,
            contentLength,
            etag,
            lastModified,
        };
    }

    private async request(operation: string, payload: Record<string, any>): Promise<any> {
        if (!this.proxyUrl) throw new Error('S3_LAMBDA_URL is not configured');
        if (!this.projectId) throw new Error('WEWEB_PROJECT_ID is not configured');

        const requestBody = JSON.stringify({
            operation,
            projectId: this.projectId,
            env: this.env,
            access: this.access,
            ...payload,
        });
        const signedRequest = await signLambdaUrlRequest({
            url: this.proxyUrl,
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: requestBody,
        });

        const response = await fetch(signedRequest.url, {
            method: 'POST',
            headers: signedRequest.headers,
            body: requestBody,
        });
        const responseBody = await parseResponseBody(response);
        const normalizedBody = normalizeProxyResponse(responseBody);

        if (!response.ok) {
            throw new Error(normalizedBody?.error || `Storage proxy request failed (${response.status})`);
        }
        if (normalizedBody?.statusCode && normalizedBody.statusCode >= 400) {
            throw new Error(normalizedBody?.error || `Storage proxy request failed (${normalizedBody.statusCode})`);
        }

        return normalizedBody;
    }
}

function normalizeProxyResponse(responseBody: any) {
    if (!responseBody) return {};
    if (typeof responseBody !== 'object') return responseBody;
    if (!Object.hasOwn(responseBody, 'statusCode') || !Object.hasOwn(responseBody, 'body')) return responseBody;
    const nestedBody = responseBody.body;
    if (typeof nestedBody === 'string') {
        try {
            return { statusCode: responseBody.statusCode, ...JSON.parse(nestedBody) };
        } catch (error) {
            return { statusCode: responseBody.statusCode, body: nestedBody };
        }
    }
    if (nestedBody && typeof nestedBody === 'object') {
        return { statusCode: responseBody.statusCode, ...nestedBody };
    }
    return responseBody;
}

async function parseResponseBody(response: Response) {
    const text = await response.text();
    if (!text) return {};
    try {
        return JSON.parse(text);
    } catch (error) {
        return { body: text };
    }
}

function normalizePositiveNumber(value: any) {
    if (value === undefined || value === null || value === '') return null;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return parsed;
}

const MAX_UPLOAD_EXPIRES_IN = 3600;
const MAX_DOWNLOAD_EXPIRES_IN = 7 * 24 * 3600;

function normalizeExpiresIn(value: any, max = MAX_UPLOAD_EXPIRES_IN) {
    const parsed = normalizePositiveNumber(value);
    if (!parsed) return 60;
    if (parsed < 10) return 10;
    if (parsed > max) return max;
    return parsed;
}

function normalizePathPrefix(value: string) {
    if (!value) return '';
    return String(value)
        .replace(/^\/+/, '')
        .replace(/\/+$/, '')
        .replace(/\/{2,}/g, '/')
        .trim();
}

function resolveStorageEnv(value: string | undefined) {
    const env = (value ?? '').trim();
    if (env && env !== 'current') return env;

    const runtimeEnv = (process.env.ENV ?? '').trim();
    if (runtimeEnv === 'editor' || runtimeEnv === 'staging' || runtimeEnv === 'production') {
        return runtimeEnv;
    }

    return env;
}

function isUnsupportedOperationError(error: any) {
    const message = String(error?.message || '').toLowerCase();
    return message.includes('unsupported operation');
}

function isNotFoundError(error: any) {
    const message = String(error?.message || '').toLowerCase();
    return message.includes('file not found') || message.includes('not found') || message.includes('(404)');
}

async function streamToUint8Array(stream: Readable) {
    const chunks = [];
    for await (const chunk of stream) {
        if (typeof chunk === 'string') chunks.push(Buffer.from(chunk));
        else chunks.push(Buffer.from(chunk));
    }
    return new Uint8Array(Buffer.concat(chunks));
}

registerStorageDriver(
    'weweb-storage',
    (visibility: 'public' | 'private', connection: ConnectionConfig, runtimeConfig: StorageRuntimeConfig) =>
        new WeWebDriver({
            cdnUrl: runtimeConfig?.appUrl,
            visibility,
            proxyUrl: runtimeConfig?.proxyUrl,
            projectId: runtimeConfig?.projectId,
            env: runtimeConfig?.env,
            access: visibility,
            keyPrefix: visibility === 'private' ? runtimeConfig?.privatePrefix : runtimeConfig?.publicPrefix,
        })
);
