import { getHubspotClient, emptyToUndefined, buildSearchRequest, mergeProperties, CONTACT_PROPERTY_KEYS } from './hubspot.utils.ts';

global.registerAction('hubspot/contacts-create', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getHubspotClient(context.connection);
    return await client.crm.contacts.basicApi.create({
        properties: mergeProperties(args, CONTACT_PROPERTY_KEYS),
        associations: emptyToUndefined(args.associations),
    });
});

global.registerAction('hubspot/contacts-update', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getHubspotClient(context.connection);
    return await client.crm.contacts.basicApi.update(args.contactId, { properties: mergeProperties(args, CONTACT_PROPERTY_KEYS) });
});

global.registerAction('hubspot/contacts-upsert', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getHubspotClient(context.connection);
    const response: any = await client.crm.contacts.batchApi.upsert({
        inputs: [
            {
                idProperty: 'email',
                id: args.email,
                properties: mergeProperties(args, CONTACT_PROPERTY_KEYS.filter(key => key !== 'email')),
            },
        ],
    });
    return response.results?.[0] ?? response;
});

global.registerAction('hubspot/contacts-get', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getHubspotClient(context.connection);
    return await client.crm.contacts.basicApi.getById(
        args.contactId,
        emptyToUndefined(args.properties),
        undefined,
        emptyToUndefined(args.associations)
    );
});

global.registerAction('hubspot/contacts-list', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getHubspotClient(context.connection);
    return await client.crm.contacts.basicApi.getPage(
        args.limit ?? undefined,
        emptyToUndefined(args.after),
        emptyToUndefined(args.properties),
        undefined,
        emptyToUndefined(args.associations)
    );
});

global.registerAction('hubspot/contacts-search', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getHubspotClient(context.connection);
    return await client.crm.contacts.searchApi.doSearch(buildSearchRequest(args));
});

global.registerAction('hubspot/contacts-delete', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getHubspotClient(context.connection);
    await client.crm.contacts.basicApi.archive(args.contactId);
    return { deleted: true, id: args.contactId };
});
