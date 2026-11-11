import { getHubspotClient, emptyToUndefined, buildSearchRequest, mergeProperties, COMPANY_PROPERTY_KEYS } from './hubspot.utils.ts';

global.registerAction('hubspot/companies-create', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getHubspotClient(context.connection);
    return await client.crm.companies.basicApi.create({
        properties: mergeProperties(args, COMPANY_PROPERTY_KEYS),
        associations: emptyToUndefined(args.associations),
    });
});

global.registerAction('hubspot/companies-update', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getHubspotClient(context.connection);
    return await client.crm.companies.basicApi.update(args.companyId, { properties: mergeProperties(args, COMPANY_PROPERTY_KEYS) });
});

global.registerAction('hubspot/companies-get', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getHubspotClient(context.connection);
    return await client.crm.companies.basicApi.getById(
        args.companyId,
        emptyToUndefined(args.properties),
        undefined,
        emptyToUndefined(args.associations)
    );
});

global.registerAction('hubspot/companies-list', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getHubspotClient(context.connection);
    return await client.crm.companies.basicApi.getPage(
        args.limit ?? undefined,
        emptyToUndefined(args.after),
        emptyToUndefined(args.properties),
        undefined,
        emptyToUndefined(args.associations)
    );
});

global.registerAction('hubspot/companies-search', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getHubspotClient(context.connection);
    return await client.crm.companies.searchApi.doSearch(buildSearchRequest(args));
});

global.registerAction('hubspot/companies-delete', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getHubspotClient(context.connection);
    await client.crm.companies.basicApi.archive(args.companyId);
    return { deleted: true, id: args.companyId };
});
