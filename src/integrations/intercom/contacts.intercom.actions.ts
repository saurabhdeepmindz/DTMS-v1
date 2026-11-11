import { getIntercomClient, buildSearchQuery, buildPagination } from './intercom.utils.ts';

// Shared contact CRUD backing the leads-* and users-* editor actions: leads and users are
// both Intercom contacts distinguished by `role` (pre-filled and hidden in the editor).

function buildContactBody(args: Record<string, any>, role: 'lead' | 'user') {
    return {
        role,
        email: args.email,
        phone: args.phone,
        name: args.name,
        avatar: args.avatar,
        external_id: args.external_id,
        signed_up_at: args.signed_up_at,
        last_seen_at: args.last_seen_at,
        owner_id: args.owner_id,
        unsubscribed_from_emails: args.unsubscribed_from_emails,
        custom_attributes: args.custom_attributes,
    };
}

async function searchByRole(client: ReturnType<typeof getIntercomClient>, args: Record<string, any>, role: string) {
    // .search() returns a Fern pagination wrapper — return the native { type, data, pages, total_count }.
    const roleFilter = { field: 'role', operator: '=', value: role };
    const userQuery = buildSearchQuery(args);
    const query: any = userQuery ? { operator: 'AND', value: [roleFilter, userQuery] } : roleFilter;
    const page = await client.contacts.search({
        query,
        pagination: buildPagination(args),
    });
    return page.response;
}

// --- leads ---

global.registerAction('intercom/leads-list', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getIntercomClient(context.connection);
    return await searchByRole(client, args, 'lead');
});

global.registerAction('intercom/leads-retrieve', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getIntercomClient(context.connection);
    return await client.contacts.find({ contact_id: args.id });
});

global.registerAction('intercom/leads-create', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getIntercomClient(context.connection);
    return await client.contacts.create(buildContactBody(args, 'lead'));
});

global.registerAction('intercom/leads-update', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getIntercomClient(context.connection);
    return await client.contacts.update({
        contact_id: args.id,
        ...buildContactBody(args, 'lead'),
    });
});

global.registerAction('intercom/leads-delete', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getIntercomClient(context.connection);
    return await client.contacts.delete({ contact_id: args.id });
});

// --- users ---

global.registerAction('intercom/users-list', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getIntercomClient(context.connection);
    return await searchByRole(client, args, 'user');
});

global.registerAction('intercom/users-retrieve', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getIntercomClient(context.connection);

    // find_by_external_id supports users only (not leads) — enforced upstream by the editor radio.
    if (args._lookup === 'external_id') {
        return await client.contacts.showContactByExternalId({ external_id: args.external_id });
    }
    return await client.contacts.find({ contact_id: args.id });
});

global.registerAction('intercom/users-create', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getIntercomClient(context.connection);
    // marked_email_as_spam / has_hard_bounced / browser / os are READ-ONLY in the modern
    // API (WW-4275 over-specced them from v1-era docs) — the SDK request types reject them.
    return await client.contacts.create(buildContactBody(args, 'user'));
});

global.registerAction('intercom/users-update', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getIntercomClient(context.connection);
    return await client.contacts.update({
        contact_id: args.id,
        ...buildContactBody(args, 'user'),
    });
});

global.registerAction('intercom/users-delete', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getIntercomClient(context.connection);
    return await client.contacts.delete({ contact_id: args.id });
});

// --- contact extras ---

global.registerAction('intercom/contacts-merge', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getIntercomClient(context.connection);
    return await client.contacts.mergeLeadInUser({
        from: args.lead_id,
        into: args.user_id,
    });
});

global.registerAction('intercom/contacts-archive', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getIntercomClient(context.connection);
    return await client.contacts.archive({ contact_id: args.id });
});

global.registerAction('intercom/contacts-unarchive', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getIntercomClient(context.connection);
    return await client.contacts.unarchive({ contact_id: args.id });
});

global.registerAction('intercom/contacts-add-note', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getIntercomClient(context.connection);
    return await client.notes.create({
        contact_id: args.contact_id,
        body: args.body,
        admin_id: args.admin_id,
    });
});

global.registerAction('intercom/contacts-tag', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getIntercomClient(context.connection);
    return await client.tags.tagContact({
        contact_id: args.contact_id,
        id: args.tag_id,
    });
});

global.registerAction('intercom/contacts-untag', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getIntercomClient(context.connection);
    return await client.tags.untagContact({
        contact_id: args.contact_id,
        tag_id: args.tag_id,
    });
});
