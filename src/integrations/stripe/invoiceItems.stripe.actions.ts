import Stripe from 'stripe';
import { compactStripeParams, plainifyStripeDecimals } from './stripe.utils.ts';

global.registerAction('stripe/invoice-items-create', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const stripeClient = new Stripe(context.connection?.secretApiKey);

    return plainifyStripeDecimals(
        await stripeClient.invoiceItems.create(
        compactStripeParams({
            customer: args.customer,
            amount: args.amount,
            currency: args.currency,
            pricing: args.pricing,
            quantity: args.quantity,
            description: args.description,
            invoice: args.invoice,
            subscription: args.subscription,
            discountable: args.discountable,
            discounts: args.discounts,
            metadata: args.metadata,
            period: args.period,
            tax_behavior: args.tax_behavior,
            tax_code: args.tax_code,
            tax_rates: args.tax_rates,
            price_data: args.price_data,
            unit_amount_decimal: args.unit_amount_decimal,
            expand: args.expand,
        })
    )
    );
});

global.registerAction('stripe/invoice-items-update', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const stripeClient = new Stripe(context.connection?.secretApiKey);

    return plainifyStripeDecimals(
        await stripeClient.invoiceItems.update(
        args.id,
        compactStripeParams({
            amount: args.amount,
            description: args.description,
            discountable: args.discountable,
            discounts: args.discounts,
            metadata: args.metadata,
            period: args.period,
            pricing: args.pricing,
            quantity: args.quantity,
            tax_behavior: args.tax_behavior,
            tax_code: args.tax_code,
            tax_rates: args.tax_rates,
            price_data: args.price_data,
            unit_amount_decimal: args.unit_amount_decimal,
            expand: args.expand,
        })
    )
    );
});

global.registerAction('stripe/invoice-items-retrieve', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const stripeClient = new Stripe(context.connection?.secretApiKey);

    return plainifyStripeDecimals(
        await stripeClient.invoiceItems.retrieve(
        args.id,
        compactStripeParams({
            expand: args.expand,
        })
    )
    );
});

global.registerAction('stripe/invoice-items-list', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const stripeClient = new Stripe(context.connection?.secretApiKey);

    return plainifyStripeDecimals(
        await stripeClient.invoiceItems.list(
        compactStripeParams({
            customer: args.customer,
            invoice: args.invoice,
            pending: args.pending,
            limit: args.limit,
            starting_after: args.starting_after,
            ending_before: args.ending_before,
            created: args.created,
            expand: args.expand,
        })
    )
    );
});

global.registerAction('stripe/invoice-items-delete', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const stripeClient = new Stripe(context.connection?.secretApiKey);

    return plainifyStripeDecimals(
        await stripeClient.invoiceItems.del(args.id)
    );
});
