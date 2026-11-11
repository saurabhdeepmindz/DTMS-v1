import Stripe from 'stripe';
import { compactStripeParams, plainifyStripeDecimals } from './stripe.utils.ts';

// `{ args = {} }` is required: an action with no user-configured fields dispatches with
// `args` undefined (WW-5001 production crash — see action_field_rules.md #19).
global.registerAction('stripe/products-create', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const stripeClient = new Stripe(context.connection?.secretApiKey);

    return plainifyStripeDecimals(
        await stripeClient.products.create(
            compactStripeParams({
                name: args.name,
                description: args.description,
                images: args.images,
                url: args.url,
                metadata: args.metadata,
                default_price_data: args.default_price_data,
                shippable: args.shippable,
                statement_descriptor: args.statement_descriptor,
                tax_code: args.tax_code,
                unit_label: args.unit_label,
                id: args.id,
                marketing_features: args.marketing_features,
                package_dimensions: args.package_dimensions,
                expand: args.expand,
            })
        )
    );
});

global.registerAction('stripe/products-update', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const stripeClient = new Stripe(context.connection?.secretApiKey);

    return plainifyStripeDecimals(
        await stripeClient.products.update(
            args.id,
            compactStripeParams({
                name: args.name,
                active: args.active,
                description: args.description,
                images: args.images,
                url: args.url,
                default_price: args.default_price,
                metadata: args.metadata,
                shippable: args.shippable,
                statement_descriptor: args.statement_descriptor,
                tax_code: args.tax_code,
                unit_label: args.unit_label,
                marketing_features: args.marketing_features,
                package_dimensions: args.package_dimensions,
                expand: args.expand,
            })
        )
    );
});

global.registerAction('stripe/products-retrieve', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const stripeClient = new Stripe(context.connection?.secretApiKey);

    return plainifyStripeDecimals(
        await stripeClient.products.retrieve(
            args.id,
            compactStripeParams({
                expand: args.expand,
            })
        )
    );
});

global.registerAction('stripe/products-list', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const stripeClient = new Stripe(context.connection?.secretApiKey);

    return plainifyStripeDecimals(
        await stripeClient.products.list(
            compactStripeParams({
                active: args.active,
                limit: args.limit,
                starting_after: args.starting_after,
                ending_before: args.ending_before,
                created: args.created,
                ids: args.ids,
                shippable: args.shippable,
                url: args.url,
                expand: args.expand,
            })
        )
    );
});

global.registerAction('stripe/products-delete', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const stripeClient = new Stripe(context.connection?.secretApiKey);

    return plainifyStripeDecimals(await stripeClient.products.del(args.id));
});

global.registerAction('stripe/products-search', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const stripeClient = new Stripe(context.connection?.secretApiKey);

    return plainifyStripeDecimals(
        await stripeClient.products.search(
            compactStripeParams({
                query: args.query,
                limit: args.limit,
                page: args.page,
                expand: args.expand,
            })
        )
    );
});
