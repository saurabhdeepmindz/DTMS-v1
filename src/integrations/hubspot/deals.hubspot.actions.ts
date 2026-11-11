import { getHubspotClient, emptyToUndefined, buildSearchRequest, mergeProperties, DEAL_PROPERTY_KEYS } from './hubspot.utils.ts';

global.registerAction('hubspot/deals-create', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getHubspotClient(context.connection);
    return await client.crm.deals.basicApi.create({
        properties: mergeProperties(args, DEAL_PROPERTY_KEYS),
        associations: emptyToUndefined(args.associations),
    });
});

global.registerAction('hubspot/deals-update', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getHubspotClient(context.connection);
    return await client.crm.deals.basicApi.update(args.dealId, { properties: mergeProperties(args, DEAL_PROPERTY_KEYS) });
});

global.registerAction('hubspot/deals-get', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getHubspotClient(context.connection);
    return await client.crm.deals.basicApi.getById(
        args.dealId,
        emptyToUndefined(args.properties),
        undefined,
        emptyToUndefined(args.associations)
    );
});

global.registerAction('hubspot/deals-list', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getHubspotClient(context.connection);
    return await client.crm.deals.basicApi.getPage(
        args.limit ?? undefined,
        emptyToUndefined(args.after),
        emptyToUndefined(args.properties),
        undefined,
        emptyToUndefined(args.associations)
    );
});

global.registerAction('hubspot/deals-search', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getHubspotClient(context.connection);
    return await client.crm.deals.searchApi.doSearch(buildSearchRequest(args));
});

global.registerAction('hubspot/deals-delete', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getHubspotClient(context.connection);
    await client.crm.deals.basicApi.archive(args.dealId);
    return { deleted: true, id: args.dealId };
});
