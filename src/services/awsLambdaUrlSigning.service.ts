import { createHash, createHmac } from 'node:crypto';
import { HttpRequest } from '@smithy/protocol-http';
import { SignatureV4 } from '@smithy/signature-v4';
import { originalEnv } from '../core/env.core.js';

type AwsCredentials = {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
};

type SignLambdaUrlRequestInput = {
    url: string;
    method: string;
    headers?: Record<string, string>;
    body?: string | Uint8Array | null;
};

type SignAwsRequestInput = SignLambdaUrlRequestInput & {
    service: string;
    region?: string;
    requiredCredentials?: boolean;
};

type SignedLambdaUrlRequest = {
    url: string;
    headers: HeadersInit;
};

export async function signLambdaUrlRequest({
    url,
    method,
    headers = {},
    body,
}: SignLambdaUrlRequestInput): Promise<SignedLambdaUrlRequest> {
    const requestUrl = parseUrl(url);

    return signAwsRequest({
        url: requestUrl.toString(),
        method,
        headers,
        body,
        region: getLambdaUrlRegion(requestUrl.hostname) || undefined,
        service: 'lambda',
    });
}

async function signAwsRequest({
    url,
    method,
    headers = {},
    body,
    region,
    service,
    requiredCredentials = false,
}: SignAwsRequestInput): Promise<SignedLambdaUrlRequest> {
    const requestUrl = parseUrl(url);

    const credentials = getAwsCredentials();
    if (!credentials && requiredCredentials) {
        throw new Error('Unable to resolve AWS credentials to sign request');
    }
    if (!credentials) {
        return {
            url: requestUrl.toString(),
            headers,
        };
    }

    const resolvedRegion = region || getExecuteApiRegion(requestUrl.hostname) || getEnvValue('AWS_REGION') || getEnvValue('AWS_DEFAULT_REGION');
    if (!resolvedRegion) {
        throw new Error('Unable to resolve AWS region to sign request');
    }

    const signer = new SignatureV4({
        credentials,
        region: resolvedRegion,
        service,
        sha256: Sha256 as any,
    });

    const request = new HttpRequest({
        method,
        protocol: requestUrl.protocol,
        hostname: requestUrl.hostname,
        port: requestUrl.port ? Number(requestUrl.port) : undefined,
        path: `${requestUrl.pathname}${requestUrl.search}`,
        headers: {
            ...headers,
            host: requestUrl.host,
        },
        body: body ?? undefined,
    });

    const signedRequest = await signer.sign(request);
    return {
        url: requestUrl.toString(),
        headers: signedRequest.headers as HeadersInit,
    };
}

function parseUrl(url: string): URL {
    const normalizedUrl = String(url).trim();
    if (normalizedUrl.startsWith('http://') || normalizedUrl.startsWith('https://')) {
        return new URL(normalizedUrl);
    }
    return new URL(`https://${normalizedUrl}`);
}

function getLambdaUrlRegion(hostname: string): string | null {
    const match = hostname.match(/\.lambda-url\.([a-z0-9-]+)\.on\.aws$/i);
    return match?.[1] || null;
}

function getExecuteApiRegion(hostname: string): string | null {
    const match = hostname.match(/\.execute-api\.([a-z0-9-]+)\.amazonaws\.com$/i);
    return match?.[1] || null;
}

function getAwsCredentials(): AwsCredentials | null {
    const accessKeyId = getEnvValue('AWS_ACCESS_KEY_ID');
    const secretAccessKey = getEnvValue('AWS_SECRET_ACCESS_KEY');
    const sessionToken = getEnvValue('AWS_SESSION_TOKEN');
    if (!accessKeyId || !secretAccessKey) return null;
    return {
        accessKeyId,
        secretAccessKey,
        sessionToken,
    };
}

function getEnvValue(key: string): string | undefined {
    return process.env[key] ?? originalEnv[key];
}

class Sha256 {
    private readonly secret?: Buffer;
    private checksum: ReturnType<typeof createHash> | ReturnType<typeof createHmac>;

    constructor(secret?: string | Uint8Array) {
        this.secret = toBuffer(secret);
        this.checksum = this.secret ? createHmac('sha256', this.secret) : createHash('sha256');
    }

    update(toHash: string | Uint8Array): void {
        this.checksum.update(toBuffer(toHash));
    }

    digest(): Promise<Uint8Array> {
        return Promise.resolve(this.checksum.digest());
    }

    reset(): void {
        this.checksum = this.secret ? createHmac('sha256', this.secret) : createHash('sha256');
    }
}

function toBuffer(value: string | Uint8Array): Buffer;
function toBuffer(value: string | Uint8Array | undefined): Buffer | undefined;
function toBuffer(value: string | Uint8Array | undefined): Buffer | undefined {
    if (value === undefined) return undefined;
    if (typeof value === 'string') return Buffer.from(value, 'utf8');
    return Buffer.from(value);
}
