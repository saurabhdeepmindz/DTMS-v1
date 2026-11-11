import { GoogleAuth } from 'google-auth-library';
import { sheets } from '@googleapis/sheets';

function getCredentialsObject(clientEmail: string, privateKey: string) {
    return {
        type: 'service_account',
        client_email: clientEmail,
        private_key: privateKey,
        auth_uri: 'https://accounts.google.com/o/oauth2/auth',
        token_uri: 'https://oauth2.googleapis.com/token',
        auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
        universe_domain: 'googleapis.com',
    };
}

export function getSheetsClient(connection: ConnectionConfig) {
    const googleAuth = new GoogleAuth({
        credentials: getCredentialsObject(connection?.clientEmail, connection?.privateKey),
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    return sheets({ version: 'v4', auth: googleAuth });
}

// Get column index by header name
export function getColumnIndex(columnIdentifier: string, headers: string[]) {
    return headers.findIndex(header => header === columnIdentifier);
}

// Convert row array to object with headers as keys
export function rowToObject(row: any[], headers: string[], columnsToInclude: string[] | null = null) {
    const rowObject: { [key: string]: any } = {};
    const columns = columnsToInclude || headers;
    columns.forEach(header => {
        const index = headers.indexOf(header);
        rowObject[header] = row[index] !== undefined ? row[index] : null;
    });
    return rowObject;
}

export function processGoogleSheetsData(
    actionData: Record<string, unknown> | undefined,
    tableLinkData: Record<string, unknown> | null
): Record<string, unknown> {
    if (!tableLinkData) return actionData || {};
    const result = { ...tableLinkData };
    if (actionData) {
        for (const [key, value] of Object.entries(actionData)) {
            if (value !== undefined && value !== null && value !== '') {
                result[key] = value;
            }
        }
    }
    return result;
}

// Find row index by ID column value
export function findRowIndexById(values: any[][], idColumnIndex: number, searchValue: string): number {
    for (let i = 1; i < values.length; i++) {
        const cellValue = values[i][idColumnIndex] !== undefined ? String(values[i][idColumnIndex]).trim() : '';
        if (cellValue === searchValue) {
            return i;
        }
    }
    return -1;
}
