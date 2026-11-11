import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

type PublicErrorData = Record<string, unknown>;

export class PublicHTTPException extends HTTPException {
    readonly publicData: PublicErrorData;

    constructor(status: ContentfulStatusCode, message: string, publicData: PublicErrorData = {}) {
        super(status, { message });
        this.publicData = publicData;
    }
}

export function serializeHttpError(error: HTTPException) {
    if (error instanceof PublicHTTPException) {
        return { ...error.publicData, message: error.message };
    }
    return { message: error.message };
}
