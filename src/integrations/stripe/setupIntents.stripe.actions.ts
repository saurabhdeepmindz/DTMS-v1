import Stripe from 'stripe';

global.registerAction('stripe/setup-intents-create', async ({ args }: ActionParams, context: ActionContext) => {
    const stripeClient = new Stripe(context.connection?.secretApiKey);

    return await stripeClient.setupIntents.create({
        customer: args.customer,
        description: args.description,
        metadata: args.metadata,
        payment_method: args.payment_method,
        payment_method_types: args.payment_method_types,
        usage: args.usage,
        attach_to_self: args.attach_to_self,
        automatic_payment_methods: args.automatic_payment_methods,
        confirm: args.confirm,
        flow_directions: args.flow_directions,
        mandate_data: args.mandate_data,
        on_behalf_of: args.on_behalf_of,
        payment_method_data: args.payment_method_data,
        payment_method_options: args.payment_method_options,
        return_url: args.return_url,
        single_use: args.single_use,
        use_stripe_sdk: args.use_stripe_sdk,
        confirmation_token: args.confirmation_token,
        payment_method_configuration: args.payment_method_configuration,
        excluded_payment_method_types: args.excluded_payment_method_types,
        customer_account: args.customer_account,
        expand: args.expand,
    });
});

global.registerAction('stripe/setup-intents-update', async ({ args }: ActionParams, context: ActionContext) => {
    const stripeClient = new Stripe(context.connection?.secretApiKey);

    return await stripeClient.setupIntents.update(args.id, {
        customer: args.customer,
        description: args.description,
        metadata: args.metadata,
        payment_method: args.payment_method,
        payment_method_types: args.payment_method_types,
        attach_to_self: args.attach_to_self,
        flow_directions: args.flow_directions,
        payment_method_data: args.payment_method_data,
        payment_method_options: args.payment_method_options,
        payment_method_configuration: args.payment_method_configuration,
        excluded_payment_method_types: args.excluded_payment_method_types,
        expand: args.expand,
    });
});

global.registerAction('stripe/setup-intents-retrieve', async ({ args }: ActionParams, context: ActionContext) => {
    const stripeClient = new Stripe(context.connection?.secretApiKey);

    return await stripeClient.setupIntents.retrieve(args.id, {
        expand: args.expand,
        client_secret: args.client_secret,
    });
});

global.registerAction('stripe/setup-intents-list', async ({ args }: ActionParams, context: ActionContext) => {
    const stripeClient = new Stripe(context.connection?.secretApiKey);

    return await stripeClient.setupIntents.list({
        customer: args.customer,
        payment_method: args.payment_method,
        limit: args.limit,
        starting_after: args.starting_after,
        ending_before: args.ending_before,
        created: args.created,
        attach_to_self: args.attach_to_self,
        expand: args.expand,
    });
});

global.registerAction('stripe/setup-intents-cancel', async ({ args }: ActionParams, context: ActionContext) => {
    const stripeClient = new Stripe(context.connection?.secretApiKey);

    return await stripeClient.setupIntents.cancel(args.id, {
        cancellation_reason: args.cancellation_reason,
        expand: args.expand,
    });
});

global.registerAction('stripe/setup-intents-confirm', async ({ args }: ActionParams, context: ActionContext) => {
    const stripeClient = new Stripe(context.connection?.secretApiKey);

    return await stripeClient.setupIntents.confirm(args.id, {
        payment_method: args.payment_method,
        mandate_data: args.mandate_data,
        payment_method_data: args.payment_method_data,
        payment_method_options: args.payment_method_options,
        return_url: args.return_url,
        confirmation_token: args.confirmation_token,
        use_stripe_sdk: args.use_stripe_sdk,
        expand: args.expand,
    });
});
