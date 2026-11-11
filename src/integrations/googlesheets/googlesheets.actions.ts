import { getSheetsClient, rowToObject, getColumnIndex, findRowIndexById, processGoogleSheetsData } from './googlesheets.utils.ts';
import { findTableLinkData } from '../utils.ts';

global.registerAction(
    'googlesheets/spreadsheets-values-list',
    async ({ args = {} }: ActionParams, context: ActionContext) => {
        const sheets = getSheetsClient(context.connection);

        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: args.spreadsheetId,
            range: args.range || args.sheetName,
            valueRenderOption: args.valueRenderOption || 'FORMATTED_VALUE',
            majorDimension: args.majorDimension || 'ROWS',
        });

        const values = response.data.values || [];
        if (values.length === 0) {
            return [];
        }

        const headers = values[0];
        const columnsToInclude =
            args.columns && args.columns.length > 0 ? args.columns.filter(col => headers.includes(col)) : null;

        return values.slice(1).map(row => rowToObject(row, headers, columnsToInclude));
    }
);

global.registerAction(
    'googlesheets/spreadsheets-values-get',
    async ({ args = {} }: ActionParams, context: ActionContext) => {
        const sheets = getSheetsClient(context.connection);

        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: args.spreadsheetId,
            range: args.sheetName,
            valueRenderOption: args.valueRenderOption || 'FORMATTED_VALUE',
            majorDimension: args.majorDimension || 'ROWS',
        });

        const values = response.data.values || [];
        if (values.length === 0) {
            return null;
        }

        const headers = values[0];
        const idColumnIndex = getColumnIndex(args.idColumn, headers);

        if (idColumnIndex === -1) {
            throw { error: { message: `ID column "${args.idColumn}" not found` } };
        }

        const searchValue = String(args.idValue || '').trim();
        const rowIndex = findRowIndexById(values, idColumnIndex, searchValue);

        if (rowIndex === -1) {
            return null;
        }

        const columnsToInclude =
            args.columns && args.columns.length > 0 ? args.columns.filter(col => headers.includes(col)) : null;

        return rowToObject(values[rowIndex], headers, columnsToInclude);
    }
);

global.registerAction(
    'googlesheets/spreadsheets-values-append',
    async ({ args = {} }: ActionParams, context: ActionContext) => {
        const sheets = getSheetsClient(context.connection);

        const headersResponse = await sheets.spreadsheets.values.get({
            spreadsheetId: args.spreadsheetId,
            range: `${args.sheetName}!1:1`,
            valueRenderOption: 'UNFORMATTED_VALUE',
            majorDimension: 'ROWS',
        });

        const headers = headersResponse.data.values?.[0] || [];
        if (headers.length === 0) {
            throw { error: { message: 'No headers found in sheet' } };
        }

        const tableLinkData = findTableLinkData({
            integration: 'googlesheets',
            context,
            matchingFunction: param =>
                param.tableConfig?.spreadsheetId === args.spreadsheetId &&
                param.tableConfig?.sheetName === args.sheetName,
        });
        const mergedValues = processGoogleSheetsData(args.values, tableLinkData);
        const rowValues = headers.map(header => mergedValues?.[header] || '');

        const response = await sheets.spreadsheets.values.append({
            spreadsheetId: args.spreadsheetId,
            range: args.sheetName,
            valueInputOption: args.valueInputOption || 'USER_ENTERED',
            insertDataOption: 'INSERT_ROWS',
            requestBody: {
                values: [rowValues],
            },
        });

        return response.data;
    }
);

global.registerAction(
    'googlesheets/spreadsheets-values-update',
    async ({ args = {} }: ActionParams, context: ActionContext) => {
        const sheets = getSheetsClient(context.connection);

        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: args.spreadsheetId,
            range: args.sheetName,
            valueRenderOption: args.valueRenderOption || 'FORMATTED_VALUE',
            majorDimension: args.majorDimension || 'ROWS',
        });

        const values = response.data.values || [];
        if (values.length === 0) {
            throw { error: { message: 'Sheet is empty' } };
        }

        const headers = values[0];
        const idColumnIndex = getColumnIndex(args.idColumn, headers);

        if (idColumnIndex === -1) {
            throw { error: { message: `ID column "${args.idColumn}" not found` } };
        }

        const searchValue = String(args.idValue || '').trim();
        const rowIndex = findRowIndexById(values, idColumnIndex, searchValue);

        if (rowIndex === -1) {
            throw { error: { message: `Row with ID "${args.idValue}" not found` } };
        }

        const rowNumber = rowIndex + 1;
        const currentRow = values[rowIndex];
        const tableLinkData = findTableLinkData({
            integration: 'googlesheets',
            context,
            matchingFunction: param =>
                param.tableConfig?.spreadsheetId === args.spreadsheetId &&
                param.tableConfig?.sheetName === args.sheetName,
        });
        const mergedValues = processGoogleSheetsData(args.values, tableLinkData);
        const updatedRow = headers.map((header, index) => {
            return header in mergedValues ? mergedValues[header] : currentRow[index] || '';
        });

        const updateResponse = await sheets.spreadsheets.values.update({
            spreadsheetId: args.spreadsheetId,
            range: `${args.sheetName}!${rowNumber}:${rowNumber}`,
            valueInputOption: args.valueInputOption || 'USER_ENTERED',
            requestBody: {
                values: [updatedRow],
            },
        });

        return updateResponse.data;
    }
);

global.registerAction(
    'googlesheets/spreadsheets-values-delete',
    async ({ args = {} }: ActionParams, context: ActionContext) => {
        const sheets = getSheetsClient(context.connection);

        const spreadsheetResponse = await sheets.spreadsheets.get({
            spreadsheetId: args.spreadsheetId,
        });

        const sheetsList = spreadsheetResponse.data.sheets || [];
        const targetSheet = sheetsList.find(sheet => sheet.properties.title === args.sheetName);

        if (!targetSheet) {
            throw { error: { message: `Sheet "${args.sheetName}" not found` } };
        }

        const valuesResponse = await sheets.spreadsheets.values.get({
            spreadsheetId: args.spreadsheetId,
            range: args.sheetName,
            valueRenderOption: args.valueRenderOption || 'FORMATTED_VALUE',
            majorDimension: args.majorDimension || 'ROWS',
        });

        const values = valuesResponse.data.values || [];
        if (values.length === 0) {
            throw { error: { message: 'Sheet is empty' } };
        }

        const headers = values[0];
        const idColumnIndex = getColumnIndex(args.idColumn, headers);

        if (idColumnIndex === -1) {
            throw { error: { message: `ID column "${args.idColumn}" not found` } };
        }

        const searchValue = String(args.idValue || '').trim();
        const rowIndex = findRowIndexById(values, idColumnIndex, searchValue);

        if (rowIndex === -1) {
            // Fail silently if row not found
            return null;
        }

        const deleteResponse = await sheets.spreadsheets.batchUpdate({
            spreadsheetId: args.spreadsheetId,
            requestBody: {
                requests: [
                    {
                        deleteDimension: {
                            range: {
                                sheetId: targetSheet.properties.sheetId,
                                dimension: 'ROWS',
                                startIndex: rowIndex,
                                endIndex: rowIndex + 1,
                            },
                        },
                    },
                ],
            },
        });

        return deleteResponse.data;
    }
);
