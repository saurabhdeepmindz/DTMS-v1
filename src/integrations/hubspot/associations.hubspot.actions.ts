import { getHubspotClient } from './hubspot.utils.ts';

// v4 associations API — createDefault applies the HUBSPOT_DEFINED unlabeled association
// between the two records; archive removes ALL associations between them.

global.registerAction('hubspot/associations-create', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getHubspotClient(context.connection);
    return await client.crm.associations.v4.basicApi.createDefault(
        args.fromObjectType,
        args.fromObjectId,
        args.toObjectType,
        args.toObjectId
    );
});

global.registerAction('hubspot/associations-remove', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getHubspotClient(context.connection);
    await client.crm.associations.v4.basicApi.archive(
        args.fromObjectType,
        args.fromObjectId,
        args.toObjectType,
        args.toObjectId
    );
    return {
        deleted: true,
        fromObjectType: args.fromObjectType,
        fromObjectId: args.fromObjectId,
        toObjectType: args.toObjectType,
        toObjectId: args.toObjectId,
    };
});
