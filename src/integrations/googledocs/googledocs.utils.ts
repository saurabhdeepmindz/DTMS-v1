import { GoogleAuth } from 'google-auth-library';
import { docs } from '@googleapis/docs';
import { drive } from '@googleapis/drive';

// Docs flows need both APIs: Docs for batchUpdate/get, Drive for copy/create/export
// (documents.create is unusable with service accounts — no parents param, 0-quota SA).
const SCOPES = ['https://www.googleapis.com/auth/documents', 'https://www.googleapis.com/auth/drive'];

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

function getGoogleAuth(connection: ConnectionConfig) {
    if (!connection?.clientEmail || !connection?.privateKey) {
        throw new Error(
            'Google Docs connection is missing or incomplete (no client email / private key) — check the connectionId and the connection configuration.'
        );
    }

    return new GoogleAuth({
        credentials: getCredentialsObject(connection.clientEmail, connection.privateKey),
        scopes: SCOPES,
    });
}

export function getDocsClient(connection: ConnectionConfig) {
    return docs({ version: 'v1', auth: getGoogleAuth(connection) });
}

export function getDriveClient(connection: ConnectionConfig) {
    return drive({ version: 'v3', auth: getGoogleAuth(connection) });
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

type ReplaceRequest = { replaceAllText: { containsText: { text: string; matchCase: boolean }; replaceText: string } };

// Merge-map keys are the LITERAL search text ({{name}} braces included — a documented
// convention, not magic). replaceAllText hits all tabs, headers and footers.
export function buildReplaceRequests(replacements: unknown, matchCase: boolean): ReplaceRequest[] {
    if (!replacements || typeof replacements !== 'object' || Array.isArray(replacements)) return [];
    return Object.entries(replacements as Record<string, unknown>)
        .filter(([, value]) => value !== undefined && value !== null)
        .map(([text, value]) => ({
            replaceAllText: {
                containsText: { text, matchCase },
                replaceText: String(value),
            },
        }));
}

export function occurrencesFromReplies(
    requests: ReplaceRequest[],
    replies: Array<{ replaceAllText?: { occurrencesChanged?: number | null } }> | undefined
): Record<string, number> {
    const occurrences: Record<string, number> = {};
    requests.forEach((request, i) => {
        occurrences[request.replaceAllText.containsText.text] = replies?.[i]?.replaceAllText?.occurrencesChanged ?? 0;
    });
    return occurrences;
}
