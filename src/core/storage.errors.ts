import type { ContentfulStatusCode } from 'hono/utils/http-status';

export class StorageError extends Error {
    status: ContentfulStatusCode;
    code: string;

    constructor(message: string, code: string, status: ContentfulStatusCode, options?: ErrorOptions) {
        super(message, options);
        this.name = new.target.name;
        this.code = code;
        this.status = status;
    }
}

export class StorageInvalidPathError extends StorageError {
    data: { code: string; message: string };

    constructor(message = 'Invalid storage path', options?: ErrorOptions) {
        super(message, 'STORAGE_INVALID_PATH', 400, options);
        this.data = { code: this.code, message: this.message };
    }
}

const INVALID_PATH_MESSAGES: Record<string, string> = {
    E_INVALID_KEY: 'File path must not be empty',
    E_UNALLOWED_CHARACTERS: 'File path contains unsupported characters',
    E_PATH_TRAVERSAL_DETECTED: 'File path must not contain parent directory segments',
};

export function normalizeStorageError<T>(error: T): T | StorageInvalidPathError {
    if (!error || typeof error !== 'object' || !('code' in error)) return error;
    const { code } = error;
    if (typeof code !== 'string' || !Object.hasOwn(INVALID_PATH_MESSAGES, code)) return error;
    return new StorageInvalidPathError(INVALID_PATH_MESSAGES[code], { cause: error });
}

export class StorageNotFoundError extends StorageError {
    constructor(message = 'File not found') {
        super(message, 'STORAGE_NOT_FOUND', 404);
    }
}

export class StorageConflictError extends StorageError {
    constructor(message = 'File already exists') {
        super(message, 'STORAGE_CONFLICT', 409);
    }
}

export class StorageUnsupportedOperationError extends StorageError {
    constructor(message = 'Overwrite move is not supported by the current storage driver') {
        super(message, 'STORAGE_UNSUPPORTED_OPERATION', 400);
    }
}
