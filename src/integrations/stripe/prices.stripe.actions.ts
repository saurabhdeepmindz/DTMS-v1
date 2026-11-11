import Stripe from 'stripe';
import { compactStripeParams, plainifyStripeDecimals } from './stripe.utils.ts';

global.registerAction('stripe/prices-create', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const stripeClient = new Stripe(context.connection?.secretApiKey);

    return plainifyStripeDecimals(
        await stripeClient.prices.create(
        compactStripeParams({
            currency: args.currency,
            product: args.product,
            product_data: args.product_data,
            unit_amount: args.unit_amount,
            unit_amount_decimal: args.unit_amount_decimal,
            custom_unit_amount: args.custom_unit_amount,
            active: args.active,
            nickname: args.nickname,
            recurring: args.recurring,
            metadata: args.metadata,
            billing_scheme: args.billing_scheme,
            lookup_key: args.lookup_key,
            transfer_lookup_key: args.transfer_lookup_key,
            tax_behavior: args.tax_behavior,
            tiers: args.tiers,
            tiers_mode: args.tiers_mode,
            transform_quantity: args.transform_quantity,
            currency_options: args.currency_options,
            expand: args.expand,
        })
    )
    );
});

global.registerAction('stripe/prices-update', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const stripeClient = new Stripe(context.connection?.secretApiKey);

    return plainifyStripeDecimals(
        await stripeClient.prices.update(
        args.id,
        compactStripeParams({
            active: args.active,
            nickname: args.nickname,
            metadata: args.metadata,
            lookup_key: args.lookup_key,
            transfer_lookup_key: args.transfer_lookup_key,
            tax_behavior: args.tax_behavior,
            currency_options: args.currency_options,
            expand: args.expand,
        })
    )
    );
});

global.registerAction('stripe/prices-retrieve', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const stripeClient = new Stripe(context.connection?.secretApiKey);

    return plainifyStripeDecimals(
        await stripeClient.prices.retrieve(
        args.id,
        compactStripeParams({
            expand: args.expand,
        })
    )
    );
});

global.registerAction('stripe/prices-list', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const stripeClient = new Stripe(context.connection?.secretApiKey);

    return plainifyStripeDecimals(
        await stripeClient.prices.list(
        compactStripeParams({
            active: args.active,
            currency: args.currency,
            product: args.product,
            type: args.type,
            limit: args.limit,
            starting_after: args.starting_after,
            ending_before: args.ending_before,
            created: args.created,
            recurring: args.recurring,
            lookup_keys: args.lookup_keys,
            expand: args.expand,
        })
    )
    );
});

global.registerAction('stripe/prices-search', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const stripeClient = new Stripe(context.connection?.secretApiKey);

    return plainifyStripeDecimals(
        await stripeClient.prices.search(
        compactStripeParams({
            query: args.query,
            limit: args.limit,
            page: args.page,
            expand: args.expand,
        })
    )
    );
});
