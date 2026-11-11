import { getSheetsClient, rowToObject } from './googlesheets.utils.ts';

global.registerTableView('googlesheets', async (connection: ConnectionConfig, table: TableConfig, view: ViewConfig) => {
    const sheets = getSheetsClient(connection);

    const response = await sheets.spreadsheets.values.get({
        spreadsheetId: table.spreadsheetId,
        range: view.range || table.sheetName,
        valueRenderOption: view.valueRenderOption || 'FORMATTED_VALUE',
        majorDimension: view.majorDimension || 'ROWS',
    });
    const values = response.data.values || [];
    if (values.length === 0) return { data: [] };

    const headers = values[0];
    const columnsToInclude =
        view.columns && view.columns.length > 0 ? view.columns.filter((col: string) => headers.includes(col)) : null;
    const rows = values.slice(1).map(row => rowToObject(row, headers, columnsToInclude));

    return { data: rows, metadata: {} };
});
