import { getHubspotClient, emptyToUndefined, buildSearchRequest, mergeProperties, TICKET_PROPERTY_KEYS } from './hubspot.utils.ts';

global.registerAction('hubspot/tickets-create', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getHubspotClient(context.connection);
    return await client.crm.tickets.basicApi.create({
        properties: mergeProperties(args, TICKET_PROPERTY_KEYS),
        associations: emptyToUndefined(args.associations),
    });
});

global.registerAction('hubspot/tickets-update', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getHubspotClient(context.connection);
    return await client.crm.tickets.basicApi.update(args.ticketId, { properties: mergeProperties(args, TICKET_PROPERTY_KEYS) });
});

global.registerAction('hubspot/tickets-get', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getHubspotClient(context.connection);
    return await client.crm.tickets.basicApi.getById(
        args.ticketId,
        emptyToUndefined(args.properties),
        undefined,
        emptyToUndefined(args.associations)
    );
});

global.registerAction('hubspot/tickets-list', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getHubspotClient(context.connection);
    return await client.crm.tickets.basicApi.getPage(
        args.limit ?? undefined,
        emptyToUndefined(args.after),
        emptyToUndefined(args.properties),
        undefined,
        emptyToUndefined(args.associations)
    );
});

global.registerAction('hubspot/tickets-search', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getHubspotClient(context.connection);
    return await client.crm.tickets.searchApi.doSearch(buildSearchRequest(args));
});

global.registerAction('hubspot/tickets-delete', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getHubspotClient(context.connection);
    await client.crm.tickets.basicApi.archive(args.ticketId);
    return { deleted: true, id: args.ticketId };
});
