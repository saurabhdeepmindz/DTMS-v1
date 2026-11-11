import { getHubspotClient } from './hubspot.utils.ts';

// MANUAL/SNAPSHOT lists only — the API rejects DYNAMIC lists with a loud error.

global.registerAction('hubspot/lists-add-contacts', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getHubspotClient(context.connection);
    return await client.crm.lists.membershipsApi.add(args.listId, args.recordIds ?? []);
});

global.registerAction('hubspot/lists-remove-contacts', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getHubspotClient(context.connection);
    return await client.crm.lists.membershipsApi.remove(args.listId, args.recordIds ?? []);
});
