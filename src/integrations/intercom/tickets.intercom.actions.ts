import { getIntercomClient, buildSearchQuery, buildPagination } from './intercom.utils.ts';

global.registerAction('intercom/tickets-create', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getIntercomClient(context.connection);

    const ticket = await client.tickets.create({
        ticket_type_id: args.ticket_type_id,
        contacts: [{ id: args.contact_id }],
        company_id: args.company_id,
    });

    // intercom-client@7 (API 2.14) has no ticket_attributes on create — the Fern serializer
    // would silently strip them. Set them right after creation instead.
    if (args.ticket_attributes && Object.keys(args.ticket_attributes).length && ticket?.id) {
        return await client.tickets.update({
            ticket_id: ticket.id,
            ticket_attributes: args.ticket_attributes,
        });
    }
    return ticket;
});

global.registerAction('intercom/tickets-update', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getIntercomClient(context.connection);

    // Intercom's ticket-update endpoint rejects string admin ids ("Id must be an integer")
    // while every other admin-id field (replies, send-message) accepts strings — and the
    // admin picker / getIntercomAdmins service produce strings. Coerce here.
    return await client.tickets.update({
        ticket_id: args.id,
        ticket_attributes: args.ticket_attributes,
        ticket_state_id: args.ticket_state_id,
        admin_id: args.admin_id != null && args.admin_id !== '' ? Number(args.admin_id) : args.admin_id,
        assignee_id: args.assignee_id != null && args.assignee_id !== '' ? Number(args.assignee_id) : args.assignee_id,
        open: args.open,
        is_shared: args.is_shared,
        snoozed_until: args.snoozed_until,
    });
});

global.registerAction('intercom/tickets-search', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getIntercomClient(context.connection);

    const page = await client.tickets.search({
        query: buildSearchQuery(args),
        pagination: buildPagination(args),
    });
    return page.response;
});

global.registerAction('intercom/tickets-reply', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getIntercomClient(context.connection);

    const body =
        args.reply_as === 'contact'
            ? {
                  message_type: 'comment' as const,
                  type: 'user' as const,
                  intercom_user_id: args.contact_id,
                  body: args.body,
              }
            : {
                  message_type: (args.message_type ?? 'comment') as 'comment' | 'note',
                  type: 'admin' as const,
                  admin_id: args.admin_id,
                  body: args.body,
              };

    return await client.tickets.reply({
        ticket_id: args.id,
        body,
    });
});
