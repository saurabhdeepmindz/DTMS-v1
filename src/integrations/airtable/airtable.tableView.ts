import { getHeaders, buildQueryString } from './airtable.utils.ts';

global.registerTableView('airtable', async (connection: ConnectionConfig, table: TableConfig, view: ViewConfig) => {
    const params = {
        timeZone: view.timeZone,
        userLocale: view.userLocale,
        pageSize: view.limit,
        offset: view.offset,
        view: view.view,
        filterByFormula: view.filterByFormula,
        cellFormat: view.cellFormat,
        returnFieldsByFieldId: view.returnFieldsByFieldId,
        recordMetadata: view.recordMetadata,
        fields: view.fields,
        sort: view.sort,
    };
    const response = await fetch(
        `https://api.airtable.com/v0/${table.baseId}/${table.tableId}${buildQueryString(params)}`,
        { headers: getHeaders(connection?.personalAccessToken) }
    );
    const data = await response.json();

    if (!response.ok) throw data;
    return {
        data: data.records || [],
        metadata: {
            limit: view.limit || 100,
            offset: view.offset || null,
            nextOffset: data.offset || null,
        },
    };
});
