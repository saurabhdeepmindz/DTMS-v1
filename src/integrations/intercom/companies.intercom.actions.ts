import { getIntercomClient } from './intercom.utils.ts';

global.registerAction('intercom/companies-list', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getIntercomClient(context.connection);

    // .list() returns a Fern pagination wrapper ({response, data, getItems, ...}); return the
    // native API response so users get the documented { type, data, pages, total_count } shape.
    const page = await client.companies.list({
        page: args.page,
        per_page: args.per_page,
        order: args.order,
    });
    return page.response;
});

global.registerAction('intercom/companies-retrieve', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getIntercomClient(context.connection);

    return await client.companies.find({ company_id: args.id });
});

global.registerAction('intercom/companies-create', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getIntercomClient(context.connection);

    return await client.companies.createOrUpdate({
        company_id: args.company_id,
        name: args.name,
        plan: args.plan,
        size: args.size,
        website: args.website,
        industry: args.industry,
        monthly_spend: args.monthly_spend,
        remote_created_at: args.remote_created_at,
        custom_attributes: args.custom_attributes,
    });
});

global.registerAction('intercom/companies-update', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getIntercomClient(context.connection);

    return await client.companies.update({
        company_id: args.id,
        body: {
            name: args.name,
            plan: args.plan,
            size: args.size,
            website: args.website,
            industry: args.industry,
            monthly_spend: args.monthly_spend,
            custom_attributes: args.custom_attributes,
        },
    });
});

global.registerAction('intercom/companies-delete', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getIntercomClient(context.connection);

    return await client.companies.delete({ company_id: args.id });
});

global.registerAction(
    'intercom/contacts-attach-company',
    async ({ args = {} }: ActionParams, context: ActionContext) => {
        const client = getIntercomClient(context.connection);

        return await client.companies.attachContact({
            contact_id: args.contact_id,
            id: args.company_id,
        });
    }
);

global.registerAction(
    'intercom/contacts-detach-company',
    async ({ args = {} }: ActionParams, context: ActionContext) => {
        const client = getIntercomClient(context.connection);

        return await client.companies.detachContact({
            contact_id: args.contact_id,
            company_id: args.company_id,
        });
    }
);
