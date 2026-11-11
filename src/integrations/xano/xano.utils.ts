import { XanoNodeClient, XanoFile } from '@xano/js-sdk';
import { HTTPException } from 'hono/http-exception';

export function getXanoClient(connection: ConnectionConfig): XanoNodeClient {
    if (!connection) throw new Error('Xano connection is required');
    const branchingEnabled = connection?.enableBranching === 'TRUE';
    return new XanoNodeClient({
        instanceBaseUrl: connection?.customDomain || `https://${connection?.instanceBaseDomain}`,
        dataSource: branchingEnabled ? connection?.xDataSource : undefined,
        customAxiosRequestConfig: {
            headers: {
                ...(connection?.globalHeaders || {}),
                ...(branchingEnabled && connection.xBranch ? { 'X-Branch': connection.xBranch } : {}),
            },
        },
    });
}

function isUploadedFile(value: any): boolean {
    return !!value && typeof value.arrayBuffer === 'function' && typeof value.name === 'string';
}

async function toXanoFile(file: any): Promise<XanoFile> {
    return new XanoFile(file.name, Buffer.from(await file.arrayBuffer()));
}

// The Node client JSON-stringifies every object it is handed, so a file has to become a XanoFile,
// the only shape it appends as a file. Measured: a repeated plain key keeps only the last file.
export async function buildRequestBody(body: any): Promise<any> {
    if (!body || typeof body !== 'object') return body;

    const payload: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(body)) {
        const files = Array.isArray(value) ? value.filter(isUploadedFile) : [];

        if (files.length > 1) {
            for (const [index, file] of files.entries()) {
                payload[`${key}[${index}]`] = await toXanoFile(file);
            }
        } else if (files.length === 1) {
            payload[key] = await toXanoFile(files[0]);
        } else if (isUploadedFile(value)) {
            payload[key] = await toXanoFile(value);
        } else {
            payload[key] = value;
        }
    }
    return payload;
}

export function buildPath(template: string, pathParams: Record<string, any> = {}): string {
    let path = template;
    for (const [key, value] of Object.entries(pathParams)) {
        path = path.replace(`{${key}}`, encodeURIComponent(String(value)));
    }
    return path;
}

export function enrichXanoError(error: any): never {
    const response = error.getResponse?.();
    const status = response?.getStatusCode?.() || 500;
    const data = response?.getBody?.();
    const message = data?.message || data?.payload?.message || error.message;

    throw new HTTPException(status, { message, cause: { status, data } });
}
