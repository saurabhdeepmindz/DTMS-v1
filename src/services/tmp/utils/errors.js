/**
 * HTTP error class for API responses
 */
export class HttpError extends Error {
  constructor(message, status = 400, code, details, cause) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.cause = cause;
  }
}

/**
 * Extracts useful information from an error object
 * In production mode, returns undefined to avoid leaking sensitive information
 */
export function getErrorDetails(sensitive, error) {
  if (sensitive)
    return undefined;

  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      details: error.details,
    };
  }

  if (
    error === null || error === undefined
    || (typeof error === 'object' && Object.keys(error).length === 0)
  ) {
    return { message: 'Unknown error occurred with no details provided' };
  }

  return error;
} 