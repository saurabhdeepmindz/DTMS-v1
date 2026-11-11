import { getHeaders, buildQueryString, processAirtableSingleFields, processAirtableData } from './airtable.utils.ts';
import { fileToDataURI, findTableLinkData } from '../utils.ts';

global.registerAction('airtable/records-list', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const params = {
        timeZone: args.timeZone,
        userLocale: args.userLocale,
        pageSize: args.pageSize,
        offset: args.offset,
        view: args.view,
        filterByFormula: args.filterByFormula,
        cellFormat: args.cellFormat,
        returnFieldsByFieldId: args.returnFieldsByFieldId,
        recordMetadata: args.recordMetadata,
        fields: args.fields,
        sort: args.sort,
    };
    const queryString = buildQueryString(params);
    const response = await fetch(`https://api.airtable.com/v0/${args.baseId}/${args.tableId}${queryString}`, {
        headers: getHeaders(context.connection?.personalAccessToken),
    });
    const data = await response.json();

    if (!response.ok) throw data;
    return data;
});

global.registerAction('airtable/records-retrieve', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const params = {
        cellFormat: args.cellFormat,
        returnFieldsByFieldId: args.returnFieldsByFieldId,
        timeZone: args.timeZone,
        userLocale: args.userLocale,
    };
    const queryString = buildQueryString(params);
    const response = await fetch(
        `https://api.airtable.com/v0/${args.baseId}/${args.tableId}/${args.recordId}${queryString}`,
        { headers: getHeaders(context.connection?.personalAccessToken) }
    );
    const data = await response.json();

    if (!response.ok) throw data;
    return data;
});

global.registerAction('airtable/records-update', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const tableLinkData = findTableLinkData({
        integration: 'airtable',
        context,
        matchingFunction: (param: any) =>
            param.tableConfig?.baseId === args.baseId && param.tableConfig?.tableId === args.tableId,
    });
    const body = {
        returnFieldsByFieldId: args.returnFieldsByFieldId,
        typecast: args.typecast,
        fields: processAirtableSingleFields(args.fields || {}, tableLinkData || {}, args._selectedFields || []),
    };

    const response = await fetch(`https://api.airtable.com/v0/${args.baseId}/${args.tableId}/${args.recordId}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
        headers: getHeaders(context.connection?.personalAccessToken),
    });
    const data = await response.json();

    if (!response.ok) throw data;
    return data;
});

global.registerAction('airtable/records-update-multiple', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const body = {
        returnFieldsByFieldId: args.returnFieldsByFieldId,
        typecast: args.typecast,
        records: (args.records || []).map(record => record || { fields: {} }),
    };

    const response = await fetch(`https://api.airtable.com/v0/${args.baseId}/${args.tableId}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
        headers: getHeaders(context.connection?.personalAccessToken),
    });
    const data = await response.json();

    if (!response.ok) throw data;
    return data;
});

global.registerAction('airtable/records-create', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const tableLinkData = findTableLinkData({
        integration: 'airtable',
        context,
        matchingFunction: (param: any) =>
            param.tableConfig?.baseId === args.baseId && param.tableConfig?.tableId === args.tableId,
    });
    const body = {
        returnFieldsByFieldId: args.returnFieldsByFieldId,
        typecast: args.typecast,
        ...(args._mode === 'multiple'
            ? {
                  records: processAirtableData(
                      (args.records || []).map((record: any) => (record || { fields: {} })?.fields || {}),
                      tableLinkData || {},
                      args._selectedFields || []
                  ).map((fields: any) => ({ fields })),
              }
            : {}),
        ...(args._mode !== 'multiple'
            ? { fields: processAirtableSingleFields(args.fields || {}, tableLinkData || {}, args._selectedFields || []) }
            : {}),
    };

    const response = await fetch(`https://api.airtable.com/v0/${args.baseId}/${args.tableId}`, {
        method: 'POST',
        body: JSON.stringify(body),
        headers: getHeaders(context.connection?.personalAccessToken),
    });
    const data = await response.json();

    if (!response.ok) throw data;
    return data;
});

global.registerAction('airtable/records-delete-multiple', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const params = {
        records: args.records,
    };
    const queryString = buildQueryString(params);
    const response = await fetch(`https://api.airtable.com/v0/${args.baseId}/${args.tableId}${queryString}`, {
        method: 'DELETE',
        headers: getHeaders(context.connection?.personalAccessToken),
    });
    const data = await response.json();

    if (!response.ok) throw data;
    return data;
});

global.registerAction('airtable/records-delete', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const response = await fetch(`https://api.airtable.com/v0/${args.baseId}/${args.tableId}/${args.recordId}`, {
        method: 'DELETE',
        headers: getHeaders(context.connection?.personalAccessToken),
    });
    const data = await response.json();

    if (!response.ok) throw data;
    return data;
});

global.registerAction('airtable/attachments-upload', async ({ args = {} }: ActionParams, context: ActionContext) => {
    if (args.file instanceof File) {
        args.file = await fileToDataURI(args.file);
    }
    const body = {
        contentType: args.contentType,
        file: args.file,
        filename: args.filename,
    };
    const response = await fetch(
        `https://content.airtable.com/v0/${args.baseId}/${args.recordId}/${args.attachmentFieldId}/uploadAttachment`,
        {
            method: 'POST',
            body: JSON.stringify(body),
            headers: getHeaders(context.connection?.personalAccessToken),
        }
    );
    const data = await response.json();

    if (!response.ok) throw data;
    return data;
});
