import { GoogleAuth } from 'google-auth-library';
import { drive } from '@googleapis/drive';

function getCredentialsObject(clientEmail: string, privateKey: string) {
    return {
        type: 'service_account',
        client_email: clientEmail,
        private_key: privateKey?.replace(/\\n/g, '\n'),
        auth_uri: 'https://accounts.google.com/o/oauth2/auth',
        token_uri: 'https://oauth2.googleapis.com/token',
        auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
        universe_domain: 'googleapis.com',
    };
}

export function getDriveClient(connection: ConnectionConfig) {
    if (!connection?.clientEmail || !connection?.privateKey) {
        throw new Error(
            'Google Drive connection is missing or incomplete (no client email / private key) — check the connectionId and the connection configuration.'
        );
    }

    const googleAuth = new GoogleAuth({
        credentials: getCredentialsObject(connection.clientEmail, connection.privateKey),
        scopes: ['https://www.googleapis.com/auth/drive'],
    });

    return drive({ version: 'v3', auth: googleAuth });
}

// Errors from calls made with responseType 'arraybuffer' surface as a bare
// "Request failed with status code NNN" while the real Google error sits (decoded or not)
// in response.data — unwrap it before rethrowing.
export function rethrowWithDecodedBody(error: unknown): never {
    let data = (error as { response?: { data?: unknown } })?.response?.data;
    if (data instanceof ArrayBuffer || Buffer.isBuffer(data)) {
        try {
            data = JSON.parse(Buffer.from(data as ArrayBuffer).toString('utf8'));
        } catch {
            data = null;
        }
    }
    if (data && typeof data === 'object' && (data as { error?: unknown }).error) {
        throw (data as { error: unknown }).error;
    }
    throw error;
}

export const DEFAULT_LIST_FIELDS =
    'nextPageToken, files(id, name, mimeType, size, modifiedTime, createdTime, webViewLink, parents, owners, iconLink, trashed, shortcutDetails)';

export const DEFAULT_FILE_FIELDS =
    'id, name, mimeType, size, modifiedTime, createdTime, webViewLink, webContentLink, parents, owners, trashed, shared, driveId, shortcutDetails, exportLinks';

// Trashed files are returned by Drive listings by default — always scope them out
// unless the user's own query already takes a position on `trashed`.
export function withTrashedFilter(q?: string) {
    if (!q) return 'trashed = false';
    if (/\btrashed\b/.test(q)) return q;
    return `(${q}) and trashed = false`;
}
