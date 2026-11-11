import type { S3Driver } from 'flydrive/drivers/s3';

export function normalizeStorageEndpoint(value?: string): string | undefined {
    if (!value?.trim()) return undefined;
    const url = new URL(value.trim());
    if (
        !['https:', 'http:'].includes(url.protocol) ||
        !(/^[a-z\d.-]+$/i.test(url.hostname) || url.hostname.startsWith('[')) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
    ) {
        throw new Error('Enter an HTTP or HTTPS storage endpoint without credentials, query parameters or fragments');
    }
    return url.href.replace(/\/+$/, '');
}

export function getR2Endpoint(accountId?: string): string {
    const account = accountId?.trim();
    if (!account || !/^[a-f0-9]{32}$/i.test(account)) throw new Error('A valid Cloudflare account ID is required');
    return `https://${account}.r2.cloudflarestorage.com`;
}

export function getS3PublicBucketUrl(bucket: string, connection: ConnectionConfig): string | null {
    return connection.region ? `https://${bucket}.s3.${connection.region}.amazonaws.com` : null;
}

export function getCompatibleS3PublicBucketUrl(bucket: string, connection: ConnectionConfig): string {
    const endpoint = normalizeStorageEndpoint(connection.endpoint);
    if (!endpoint) throw new Error('An S3-compatible endpoint is required');
    const url = new URL(endpoint);
    const virtualHosted = connection.forcePathStyle === false || connection.forcePathStyle === 'false';
    if (virtualHosted) url.hostname = `${bucket}.${url.hostname}`;
    else url.pathname = `${url.pathname.replace(/\/+$/, '')}/${bucket}`;
    return url.href.replace(/\/+$/, '');
}

export function createS3StorageOptions(
    visibility: 'public' | 'private',
    connection: ConnectionConfig,
    runtimeConfig: StorageRuntimeConfig,
    provider: 'aws-s3' | 's3-compatible' | 'cloudflare' = 'aws-s3'
): ConstructorParameters<typeof S3Driver>[0] {
    const isR2 = provider === 'cloudflare';
    const endpoint = isR2
        ? getR2Endpoint(connection.accountId)
        : provider === 's3-compatible'
          ? normalizeStorageEndpoint(connection.endpoint)
          : undefined;
    if (provider === 's3-compatible' && !endpoint) throw new Error('An S3-compatible endpoint is required');
    const cdnUrl = normalizeStorageEndpoint(runtimeConfig.cdnUrl);
    if (isR2 && visibility === 'public' && !cdnUrl) {
        throw new Error('Configure the public R2 bucket domain in Storage > Settings > Public bucket URL');
    }
    if (isR2 && visibility === 'public' && new URL(cdnUrl).hostname.endsWith('.r2.cloudflarestorage.com')) {
        throw new Error('Use the public R2 bucket domain, not the authenticated S3 API endpoint');
    }
    const bucket = visibility === 'private' ? runtimeConfig.privateBucket : runtimeConfig.publicBucket;
    if (!bucket?.trim()) throw new Error(`A ${visibility} storage bucket is required`);
    const forcePathStyle =
        isR2 || connection.forcePathStyle === undefined || connection.forcePathStyle === ''
            ? true
            : connection.forcePathStyle === true || connection.forcePathStyle === 'true';
    return {
        credentials: { accessKeyId: connection.accessKeyId, secretAccessKey: connection.secretAccessKey },
        region: isR2 ? 'auto' : connection.region?.trim() || 'us-east-1',
        bucket: bucket.trim(),
        visibility,
        supportsACL: false,
        ...(endpoint
            ? {
                  endpoint,
                  forcePathStyle,
                  requestChecksumCalculation: 'WHEN_REQUIRED',
                  responseChecksumValidation: 'WHEN_REQUIRED',
              }
            : {}),
        ...(cdnUrl || endpoint
            ? {
                  ...(cdnUrl ? { cdnUrl: `${cdnUrl}/` } : {}),
                  urlBuilder: {
                      generateURL: async key => {
                          const encodedKey = key.split('/').map(encodeURIComponent).join('/');
                          if (cdnUrl) return `${cdnUrl}/${encodedKey}`;
                          return `${getCompatibleS3PublicBucketUrl(bucket, { endpoint, forcePathStyle })}/${encodedKey}`;
                      },
                  },
              }
            : {}),
    };
}
