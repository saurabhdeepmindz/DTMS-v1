import Stripe from 'stripe';

global.registerAction('stripe/charges-create', async ({ args }: ActionParams, context: ActionContext) => {
    const stripeClient = new Stripe(context.connection?.secretApiKey);

    return await stripeClient.charges.create({
        amount: args.amount,
        currency: args.currency,
        customer: args.customer,
        description: args.description,
        metadata: args.metadata,
        receipt_email: args.receipt_email,
        shipping: args.shipping,
        source: args.source,
        statement_descriptor: args.statement_descriptor,
        statement_descriptor_suffix: args.statement_descriptor_suffix,
        capture: args.capture,
        on_behalf_of: args.on_behalf_of,
        transfer_data: args.transfer_data,
        transfer_group: args.transfer_group,
        application_fee_amount: args.application_fee_amount,
        radar_options: args.radar_options,
    });
});

global.registerAction('stripe/charges-update', async ({ args }: ActionParams, context: ActionContext) => {
    const stripeClient = new Stripe(context.connection?.secretApiKey);

    return await stripeClient.charges.update(args.charge, {
        description: args.description,
        metadata: args.metadata,
        receipt_email: args.receipt_email,
        shipping: args.shipping,
        fraud_details: args.fraud_details,
        transfer_group: args.transfer_group,
        customer: args.customer,
        expand: args.expand,
    });
});

global.registerAction('stripe/charges-retrieve', async ({ args }: ActionParams, context: ActionContext) => {
    const stripeClient = new Stripe(context.connection?.secretApiKey);

    return await stripeClient.charges.retrieve(args.id, {
        expand: args.expand,
    });
});

global.registerAction('stripe/charges-list', async ({ args }: ActionParams, context: ActionContext) => {
    const stripeClient = new Stripe(context.connection?.secretApiKey);

    return await stripeClient.charges.list({
        customer: args.customer,
        limit: args.limit,
        starting_after: args.starting_after,
        ending_before: args.ending_before,
        created: args.created,
        payment_intent: args.payment_intent,
        transfer_group: args.transfer_group,
        expand: args.expand,
    });
});

global.registerAction('stripe/charges-capture', async ({ args }: ActionParams, context: ActionContext) => {
    const stripeClient = new Stripe(context.connection?.secretApiKey);

    return await stripeClient.charges.capture(args.charge, {
        amount: args.amount,
        receipt_email: args.receipt_email,
        statement_descriptor: args.statement_descriptor,
        statement_descriptor_suffix: args.statement_descriptor_suffix,
        transfer_data: args.transfer_data,
        transfer_group: args.transfer_group,
        application_fee_amount: args.application_fee_amount,
        expand: args.expand,
    });
});

global.registerAction('stripe/charges-search', async ({ args }: ActionParams, context: ActionContext) => {
    const stripeClient = new Stripe(context.connection?.secretApiKey);

    return await stripeClient.charges.search({
        query: args.query,
        limit: args.limit,
        page: args.page,
        expand: args.expand,
    });
});
