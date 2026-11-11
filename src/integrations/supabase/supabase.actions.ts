import {
    getSupabaseClient,
    SupabaseQueryBuilder,
    processSupabaseObjectData,
} from './supabase.utils.ts';
import { fileToDataURI, fileToBuffer, isDataURI, dataURIToBuffer, dataURIToContentType, findTableLinkData } from '../utils.ts';
import type { SupabaseMutationActionArgs, SupabaseSelectActionArgs, SupabaseTableConfig } from './supabase.types.ts';

function processSupabaseMutationData(data: SupabaseMutationActionArgs['data'], tableLinkData: Record<string, unknown>) {
    if (Array.isArray(data)) return data.map(item => processSupabaseObjectData(item, tableLinkData));
    return processSupabaseObjectData(data || {}, tableLinkData);
}

global.registerAction<SupabaseSelectActionArgs>('supabase/select', async ({ args }, context) => {
    const client = getSupabaseClient(context.connection);

    const queryBuilder = new SupabaseQueryBuilder(args);
    let query = client.from(args.table).select(queryBuilder.selectString, args.count ? { count: args.count } : {});

    query = queryBuilder.applyFilters(query);
    query = queryBuilder.applySort(query);
    query = queryBuilder.applyActionPagination(query);
    const resultQuery = queryBuilder.applySingleResult(query);

    const { data, error, count } = await resultQuery;
    if (error) throw error;
    return args.count ? { data, count } : data;
});

global.registerAction<SupabaseMutationActionArgs>('supabase/insert', async ({ args }, context) => {
    const client = getSupabaseClient(context.connection);

    const tableLinkData = findTableLinkData({
        integration: 'supabase',
        context,
        matchingFunction: (param: TableLinkDefinition<SupabaseTableConfig>) => param.tableConfig?.table === args.table,
    });
    const data = tableLinkData ? processSupabaseMutationData(args.data, tableLinkData) : args.data;

    const selectColumns = (args.returnColumns || []).join(',') || '*';
    const builder = client.from(args.table).insert(data);
    const { data: result, error } = await (args.returnMode === 'none' ? builder : builder.select(selectColumns));

    if (error) throw error;
    return result;
});

global.registerAction<SupabaseMutationActionArgs>('supabase/update', async ({ args }, context) => {
    const client = getSupabaseClient(context.connection);

    const tableLinkData = findTableLinkData({
        integration: 'supabase',
        context,
        matchingFunction: (param: TableLinkDefinition<SupabaseTableConfig>) => param.tableConfig?.table === args.table,
    });
    const updateData = tableLinkData ? processSupabaseMutationData(args.data, tableLinkData) : args.data;

    const selectColumns = (args.returnColumns || []).join(',') || '*';
    let query = client.from(args.table).update(updateData);
    query = new SupabaseQueryBuilder(args).applyFilters(query);
    const { data, error, count } = await (args.returnMode === 'none' ? query : query.select(selectColumns));

    if (error) throw error;
    return args.count ? { data, count } : data;
});

global.registerAction<SupabaseMutationActionArgs>('supabase/upsert', async ({ args }, context) => {
    const client = getSupabaseClient(context.connection);

    const tableLinkData = findTableLinkData({
        integration: 'supabase',
        context,
        matchingFunction: (param: TableLinkDefinition<SupabaseTableConfig>) => param.tableConfig?.table === args.table,
    });
    const data = tableLinkData ? processSupabaseMutationData(args.data, tableLinkData) : args.data;

    const selectColumns = (args.returnColumns || []).join(',') || '*';
    const builder = client.from(args.table).upsert(data, {
        onConflict: args.onConflict?.join(','),
        ignoreDuplicates: args.ignoreDuplicates,
    });
    const { data: result, error } = await (args.returnMode === 'none' ? builder : builder.select(selectColumns));

    if (error) throw error;
    return result;
});

global.registerAction<SupabaseMutationActionArgs>('supabase/delete', async ({ args }, context) => {
    const client = getSupabaseClient(context.connection);

    const selectColumns = (args.returnColumns || []).join(',') || '*';
    let query = client.from(args.table).delete();
    query = new SupabaseQueryBuilder(args).applyFilters(query);
    const { data, error } = await (args.returnMode === 'none' ? query : query.select(selectColumns));

    if (error) throw error;
    return data;
});

global.registerAction('supabase/storage-list', async ({ args }: ActionParams, context: ActionContext) => {
    const client = getSupabaseClient(context.connection);

    const { data, error } = await client.storage.from(args.id).list(args.path, {
        limit: args.limit,
        offset: args.offset,
        search: args.search,
        sortBy: args.sortBy,
    });

    if (error) throw error;
    return data;
});

global.registerAction('supabase/storage-upload', async ({ args }: ActionParams, context: ActionContext) => {
    const client = getSupabaseClient(context.connection);

    if (args.fileBody instanceof File) {
        if (!args.contentType && args.fileBody.type) {
            args.contentType = args.fileBody.type;
        }
        args.fileBody = await fileToBuffer(args.fileBody);
    } else if (isDataURI(args.fileBody)) {
        if (!args.contentType) {
            args.contentType = dataURIToContentType(args.fileBody);
        }
        args.fileBody = dataURIToBuffer(args.fileBody);
    }
    const { data, error } = await client.storage.from(args.id).upload(args.path, args.fileBody, {
        upsert: args.upsert,
        contentType: args.contentType,
        cacheControl: args.cacheControl,
    });

    if (error) throw error;
    return data;
});

global.registerAction('supabase/storage-remove', async ({ args }: ActionParams, context: ActionContext) => {
    const client = getSupabaseClient(context.connection);

    const { data, error } = await client.storage.from(args.id).remove(args.paths);

    if (error) throw error;
    return data;
});

global.registerAction('supabase/storage-create-signed-url', async ({ args }: ActionParams, context: ActionContext) => {
    const client = getSupabaseClient(context.connection);

    const { data, error } = await client.storage.from(args.id).createSignedUrl(args.path, args.expiresIn, {
        transform: args.transform,
    });

    if (error) throw error;
    return data;
});

global.registerAction('supabase/storage-get-public-url', async ({ args }: ActionParams, context: ActionContext) => {
    const client = getSupabaseClient(context.connection);

    const { data } = client.storage.from(args.id).getPublicUrl(args.path, {
        download: args.download,
        transform: args.transform,
    });

    return data;
});

global.registerAction('supabase/storage-download', async ({ args }: ActionParams, context: ActionContext) => {
    const client = getSupabaseClient(context.connection);

    const { data, error } = await client.storage.from(args.id).download(args.path);

    if (error) throw error;
    return await fileToDataURI(data);
});

global.registerAction('supabase/storage-update', async ({ args }: ActionParams, context: ActionContext) => {
    const client = getSupabaseClient(context.connection);

    if (args.fileBody instanceof File) {
        if (!args.contentType && args.fileBody.type) {
            args.contentType = args.fileBody.type;
        }
        args.fileBody = await fileToBuffer(args.fileBody);
    } else if (isDataURI(args.fileBody)) {
        if (!args.contentType) {
            args.contentType = dataURIToContentType(args.fileBody);
        }
        args.fileBody = dataURIToBuffer(args.fileBody);
    }
    const { data, error } = await client.storage.from(args.id).update(args.path, args.fileBody, {
        contentType: args.contentType,
        cacheControl: args.cacheControl,
    });

    if (error) throw error;
    return data;
});

global.registerAction('supabase/storage-move', async ({ args }: ActionParams, context: ActionContext) => {
    const client = getSupabaseClient(context.connection);

    const { data, error } = await client.storage.from(args.id).move(args.fromPath, args.toPath);

    if (error) throw error;
    return data;
});

global.registerAction('supabase/storage-copy', async ({ args }: ActionParams, context: ActionContext) => {
    const client = getSupabaseClient(context.connection);

    const { data, error } = await client.storage.from(args.id).copy(args.fromPath, args.toPath);

    if (error) throw error;
    return data;
});

global.registerAction('supabase/rpc', async ({ args }: ActionParams, context: ActionContext) => {
    const client = getSupabaseClient(context.connection);

    let query = client.rpc(args.fn, args.params);
    if (args.single) query = query.single() as any;
    const { data, error } = await query;

    if (error) throw error;
    return data;
});

global.registerAction('supabase/functions-invoke', async ({ args }: ActionParams, context: ActionContext) => {
    const client = getSupabaseClient(context.connection);

    const { data, error } = await client.functions.invoke(args.functionName, {
        method: args.method,
        body: args.body,
        headers: args.headers,
    });

    if (error) throw error;
    return data;
});
