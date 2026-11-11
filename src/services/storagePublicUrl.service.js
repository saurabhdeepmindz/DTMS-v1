import { normalizePath, resolveStorageConnectionConfig, resolveStorageRuntimeConfig } from '../core/storage.core.ts';
import { getCompatibleS3PublicBucketUrl, getS3PublicBucketUrl } from '../integrations/aws-s3/s3Storage.utils.ts';

function normalizeBaseUrl(baseUrl) {
    const normalizedBaseUrl = String(baseUrl || '')
        .trim()
        .replace(/\/+$/, '');
    if (!normalizedBaseUrl) {
        throw new Error('Storage CDN URL is not configured');
    }
    return normalizedBaseUrl;
}

function isWewebDomain(hostname) {
    return hostname === 'weweb.io' || hostname.endsWith('.weweb.io') || /^(.+\.)?weweb-[a-z0-9-]+\.io$/.test(hostname);
}

function parseAppUrls(appUrl) {
    if (Array.isArray(appUrl)) {
        return appUrl;
    }

    const normalizedAppUrl = String(appUrl || '').trim();
    if (!normalizedAppUrl) {
        return [];
    }

    try {
        const parsedAppUrl = JSON.parse(normalizedAppUrl);
        if (Array.isArray(parsedAppUrl)) {
            return parsedAppUrl;
        }
    } catch {}

    return [normalizedAppUrl];
}

function getPreferredAppUrl(appUrl) {
    const normalizedAppUrls = parseAppUrls(appUrl).map(normalizeBaseUrl);
    if (!normalizedAppUrls.length) {
        throw new Error('Storage CDN URL is not configured');
    }

    for (const candidateUrl of normalizedAppUrls) {
        try {
            const parsedCandidateUrl = new URL(candidateUrl);
            if (!isWewebDomain(parsedCandidateUrl.hostname.toLowerCase())) {
                return candidateUrl;
            }
        } catch {}
    }

    return normalizedAppUrls[0];
}

// Absent providers are deliberate: Cloudflare R2 and the others need a public domain we do not
// hold, so they keep requiring STORAGE_CDN_URL and get the error below.
const PUBLIC_BUCKET_URL_BUILDERS = {
    'aws-s3': getS3PublicBucketUrl,
    's3-compatible': getCompatibleS3PublicBucketUrl,
};

function getDerivedPublicBucketUrl(runtimeConfig) {
    const buildPublicBucketUrl = PUBLIC_BUCKET_URL_BUILDERS[runtimeConfig.integration];
    if (!buildPublicBucketUrl || !runtimeConfig.publicBucket) return null;

    const connectionConfig = resolveStorageConnectionConfig('public', runtimeConfig);
    if (!connectionConfig) return null;

    return buildPublicBucketUrl(runtimeConfig.publicBucket, connectionConfig);
}

function getStorageUrl(key, access = 'public', env = 'current') {
    if (access !== 'public') {
        throw new Error('getStorageUrl only supports public storage');
    }

    const normalizedKey = normalizePath(String(key || '').trim());
    if (!normalizedKey) {
        throw new Error('Storage key is required');
    }
    const encodedKey = normalizedKey.split('/').map(encodeURIComponent).join('/');

    const runtimeConfig = resolveStorageRuntimeConfig(env);
    if (!runtimeConfig.integration) {
        throw new Error('No storage driver configured');
    }

    if (runtimeConfig.integration === 'weweb-storage') {
        const appUrl = getPreferredAppUrl(runtimeConfig.appUrl);
        return `${appUrl}/storage/public/${encodedKey}`;
    }

    if (runtimeConfig.cdnUrl) {
        return `${normalizeBaseUrl(runtimeConfig.cdnUrl)}/${encodedKey}`;
    }

    const derivedBucketUrl = getDerivedPublicBucketUrl(runtimeConfig);
    if (!derivedBucketUrl) {
        throw new Error(
            `No public URL can be built for the "${runtimeConfig.integration}" storage provider: set a CDN URL in the project storage settings, or a public bucket whose provider exposes a derivable public endpoint.`
        );
    }

    return `${derivedBucketUrl}/${encodedKey}`;
}

export { getStorageUrl };
