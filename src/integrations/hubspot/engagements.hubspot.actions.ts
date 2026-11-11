import { getHubspotClient, emptyToUndefined, buildSearchRequest } from './hubspot.utils.ts';

// Engagements are regular CRM objects reached through the generic /crm/v3/objects/{type}
// endpoints; args.type is one of: meetings, calls, emails, notes, tasks, communications,
// postal_mail.

global.registerAction('hubspot/engagements-create', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getHubspotClient(context.connection);
    return await client.crm.objects.basicApi.create(args.type, {
        properties: args.properties ?? {},
        associations: emptyToUndefined(args.associations),
    });
});

global.registerAction('hubspot/engagements-update', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getHubspotClient(context.connection);
    return await client.crm.objects.basicApi.update(args.type, args.engagementId, {
        properties: args.properties ?? {},
    });
});

global.registerAction('hubspot/engagements-get', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getHubspotClient(context.connection);
    return await client.crm.objects.basicApi.getById(
        args.type,
        args.engagementId,
        emptyToUndefined(args.properties),
        undefined,
        emptyToUndefined(args.associations)
    );
});

global.registerAction('hubspot/engagements-list', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getHubspotClient(context.connection);
    return await client.crm.objects.basicApi.getPage(
        args.type,
        args.limit ?? undefined,
        emptyToUndefined(args.after),
        emptyToUndefined(args.properties),
        undefined,
        emptyToUndefined(args.associations)
    );
});

global.registerAction('hubspot/engagements-search', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getHubspotClient(context.connection);
    return await client.crm.objects.searchApi.doSearch(args.type, buildSearchRequest(args));
});

global.registerAction('hubspot/engagements-delete', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getHubspotClient(context.connection);
    await client.crm.objects.basicApi.archive(args.type, args.engagementId);
    return { deleted: true, id: args.engagementId, type: args.type };
});
