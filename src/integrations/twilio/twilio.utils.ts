import twilio from 'twilio';

export function getClient(connection: ConnectionConfig) {
    return twilio(connection?.accountSid, connection?.authToken);
}

// Twilio resource instances are not JSON-serializable; toJSON() returns the plain payload
export function serialize(instance: any) {
    if (instance && typeof instance.toJSON === 'function') return instance.toJSON();
    return instance;
}

// Twilio's RestException carries a numeric `code` (e.g. 21211), an HTTP `status` and a `moreInfo`
// URL. The generic workflow error capture only keeps name/message/cause on Error instances, so we
// rethrow a plain object to preserve `errorCode` for programmatic branching (BUG-5).
export function toTwilioError(error: any) {
    if (error && (error.code !== undefined || error.status !== undefined)) {
        return {
            name: error.name || 'TwilioError',
            message: error.message,
            errorCode: error.code,
            status: error.status,
            moreInfo: error.moreInfo,
        };
    }
    return error;
}

// Extract the PageToken from a Twilio nextPageUrl to use as pagination cursor
export function extractPageToken(url?: string | null): string | null {
    if (!url) return null;
    const match = url.match(/[?&]PageToken=([^&]+)/);
    return match ? decodeURIComponent(match[1]) : null;
}
