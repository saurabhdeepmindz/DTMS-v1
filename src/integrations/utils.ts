import { getParametersInContext } from '../services/tmp/codeEval/utils.js';
import { getAppUrls } from '../core/config.core.js';
import pages from '../data/pages.json' with { type: 'json' };

export function isDataURI(value: unknown): boolean {
    return typeof value === 'string' && value.startsWith('data:');
}

export function dataURIToBase64(dataURI: string): string {
    return dataURI.split(',')[1];
}

export function dataURIToBuffer(dataURI: string): Buffer {
    return Buffer.from(dataURIToBase64(dataURI), 'base64');
}

export function dataURIToContentType(dataURI: string): string {
    const match = dataURI.match(/^data:([^;,]+)[;,]/);
    return match?.[1] || '';
}

export function bytesToDataURI(bytes: Uint8Array | Buffer | string, contentType: string): string {
    return `data:${contentType};base64,${Buffer.from(bytes).toString('base64')}`;
}

export async function fileToDataURI(file: File | Blob): Promise<string> {
    const arrayBuffer = await file.arrayBuffer();
    return `data:${file.type};base64,${Buffer.from(arrayBuffer).toString('base64')}`;
}

export async function fileToBuffer(file: File | Blob): Promise<Buffer> {
    return Buffer.from(await file.arrayBuffer());
}

export async function transformFileAttachments(attachments: unknown, contentKey: string): Promise<unknown> {
    if (!Array.isArray(attachments)) return attachments;
    return Promise.all(
        attachments.map(async attachment => {
            if (attachment?.[contentKey] instanceof File) {
                const file = attachment[contentKey];
                return {
                    ...attachment,
                    [contentKey]: Buffer.from(await file.arrayBuffer()).toString('base64'),
                };
            }
            if (isDataURI(attachment?.[contentKey])) {
                return {
                    ...attachment,
                    [contentKey]: dataURIToBase64(attachment[contentKey]),
                };
            }
            return attachment;
        })
    );
}

export const findTableLinkData = ({ integration, context, matchingFunction }) => {
    const parameters = getParametersInContext(context);
    for (const parameterKey of Object.keys(parameters)) {
        if (!parameterKey.startsWith(`table:${integration}/`)) continue;
        const parameterName = parameterKey.split(':')[1];
        const tableLinkDefinition = context.workflowDefinition?.parameters?.find(param => param.name === parameterName);
        if (tableLinkDefinition && matchingFunction(tableLinkDefinition)) {
            const data = parameters[parameterKey];
            const allowedColumns: string[] = tableLinkDefinition.columns;
            if (!allowedColumns?.length || !data || typeof data !== 'object') {
                return data;
            }
            const filteredData: Record<string, unknown> = {};
            for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
                if (allowedColumns.includes(key)) {
                    filteredData[key] = value;
                }
            }
            return filteredData;
        }
    }
    return null;
};

export const getPageUrl = (
    pageConfig:
        | string
        | {
              type: 'internal' | 'external';
              pageId?: string;
              url?: string;
              query?: { name: string; value: unknown }[];
          }
) => {
    if (!pageConfig) return undefined;
    // A bound plain string is an external URL (WW-5170 QA 5170-1).
    if (typeof pageConfig === 'string') return pageConfig;

    let url: string | undefined;
    if (pageConfig.type === 'internal') {
        const appUrl = getAppUrls()[0];
        if (process.env.ENV === 'editor') {
            url = `${appUrl}/${pageConfig.pageId}`;
        } else {
            const page = pageConfig.pageId ? pages[pageConfig.pageId] : undefined;
            const path = page?.isHomePage ? '' : page?.paths?.default;
            url = `${appUrl}/${path}`;
        }
    } else if (pageConfig.type === 'external') {
        url = pageConfig.url;
    }
    if (!url) return undefined;

    // Append the page picker's query params (WW-5170 QA 5170-10). `{PLACEHOLDER}` tokens
    // must stay literal — providers substitute them (e.g. Stripe's {CHECKOUT_SESSION_ID}).
    if (Array.isArray(pageConfig.query) && pageConfig.query.length) {
        const encode = (value: unknown) =>
            encodeURIComponent(String(value ?? '')).replace(/%7B/gi, '{').replace(/%7D/gi, '}');
        const queryString = pageConfig.query
            .filter(param => param && param.name)
            .map(param => `${encode(param.name)}=${encode(param.value)}`)
            .join('&');
        if (queryString) url += (url.includes('?') ? '&' : '?') + queryString;
    }
    return url;
};

export default {
    isDataURI,
    dataURIToBase64,
    dataURIToBuffer,
    dataURIToContentType,
    bytesToDataURI,
    fileToDataURI,
    fileToBuffer,
    transformFileAttachments,
    findTableLinkData,
    getPageUrl,
};
