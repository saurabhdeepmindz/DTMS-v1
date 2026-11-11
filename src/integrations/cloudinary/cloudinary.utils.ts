import { v2 as cloudinary } from 'cloudinary';

export function configureCloudinary(connection: ConnectionConfig) {
    cloudinary.config({
        cloud_name: connection?.cloudName,
        api_key: connection?.apiKey,
        api_secret: connection?.apiSecret,
    });
    return cloudinary;
}

// Admin API rejections wrap the raw HTTPS request options — including the
// api_key:api_secret basic-auth pair — so the SDK error must never reach
// workflow errors as-is. Rethrow only the provider error part.
export function throwSanitizedAdminError(err: unknown): never {
    if (err && typeof err === 'object') {
        const wrapped = err as { error?: unknown; request_options?: unknown };
        if (wrapped.error) throw wrapped.error;
        if (wrapped.request_options) {
            const { request_options: _stripped, ...rest } = wrapped as Record<string, unknown>;
            throw rest;
        }
    }
    throw err;
}

// The three functions below mirror cloudinary.front.ts (weweb-editor) byte-for-byte:
// api_sign_request signs raw `k=v` strings, so any divergence from what the browser
// puts in its FormData ("[object Object]", eager joined with "," instead of "|", ...)
// makes Cloudinary reject the upload with "Invalid Signature".

export function transformationToSignedString(t: unknown): string | undefined {
    if (!t || typeof t !== 'object') return undefined;
    const o = t as Record<string, unknown>;
    const parts: string[] = [];
    if (typeof o.width === 'number') parts.push(`w_${o.width}`);
    if (typeof o.height === 'number') parts.push(`h_${o.height}`);
    if (typeof o.crop === 'string' && o.crop) parts.push(`c_${o.crop}`);
    if (typeof o.aspect_ratio === 'string' && o.aspect_ratio) parts.push(`ar_${o.aspect_ratio}`);
    if (typeof o.quality === 'string' && o.quality) parts.push(`q_${o.quality}`);
    if (typeof (o as { raw_transformation?: string }).raw_transformation === 'string') {
        parts.push((o as { raw_transformation: string }).raw_transformation);
    }
    return parts.length ? parts.join(',') : undefined;
}

export function contextToSignedString(ctx: unknown): string | undefined {
    if (ctx == null || typeof ctx !== 'object') return undefined;
    const o = ctx as Record<string, unknown>;
    const pairs = Object.entries(o)
        .filter(([, val]) => val != null && val !== '')
        .map(([k, val]) => `${k}=${String(val)}`);
    return pairs.length ? pairs.join('|') : undefined;
}

export function eagerToSignedString(eager: unknown): string | undefined {
    if (!Array.isArray(eager) || !eager.length) return undefined;
    return eager.join('|');
}
