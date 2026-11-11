import Stripe from 'stripe';
import { compactStripeParams, plainifyStripeDecimals } from './stripe.utils.ts';

global.registerAction('stripe/subscriptions-create', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const stripeClient = new Stripe(context.connection?.secretApiKey);

    return plainifyStripeDecimals(
        await stripeClient.subscriptions.create(
        compactStripeParams({
            customer: args.customer,
            items: args.items,
            cancel_at_period_end: args.cancel_at_period_end,
            default_payment_method: args.default_payment_method,
            description: args.description,
            collection_method: args.collection_method,
            metadata: args.metadata,
            days_until_due: args.days_until_due,
            backdate_start_date: args.backdate_start_date,
            billing_cycle_anchor: args.billing_cycle_anchor,
            cancel_at: args.cancel_at,
            discounts: args.discounts,
            default_tax_rates: args.default_tax_rates,
            off_session: args.off_session,
            payment_behavior: args.payment_behavior,
            payment_settings: args.payment_settings,
            pending_invoice_item_interval: args.pending_invoice_item_interval,
            proration_behavior: args.proration_behavior,
            transfer_data: args.transfer_data,
            trial_end: args.trial_end,
            trial_period_days: args.trial_period_days,
            trial_settings: args.trial_settings,
            add_invoice_items: args.add_invoice_items,
            application_fee_percent: args.application_fee_percent,
            automatic_tax: args.automatic_tax,
            currency: args.currency,
            on_behalf_of: args.on_behalf_of,
            invoice_settings: args.invoice_settings,
            default_source: args.default_source,
            billing_cycle_anchor_config: args.billing_cycle_anchor_config,
            billing_mode: args.billing_mode,
            billing_thresholds: args.billing_thresholds,
            customer_account: args.customer_account,
            trial_from_plan: args.trial_from_plan,
            expand: args.expand,
        })
    )
    );
});

global.registerAction('stripe/subscriptions-update', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const stripeClient = new Stripe(context.connection?.secretApiKey);

    const params = compactStripeParams({
        cancel_at_period_end: args.cancel_at_period_end,
        default_payment_method: args.default_payment_method,
        description: args.description,
        items: args.items,
        metadata: args.metadata,
        billing_cycle_anchor: args.billing_cycle_anchor,
        cancel_at: args.cancel_at,
        collection_method: args.collection_method,
        discounts: args.discounts,
        days_until_due: args.days_until_due,
        default_tax_rates: args.default_tax_rates,
        off_session: args.off_session,
        pause_collection: args.pause_collection,
        payment_behavior: args.payment_behavior,
        payment_settings: args.payment_settings,
        pending_invoice_item_interval: args.pending_invoice_item_interval,
        proration_behavior: args.proration_behavior,
        proration_date: args.proration_date,
        transfer_data: args.transfer_data,
        trial_end: args.trial_end,
        trial_settings: args.trial_settings,
        add_invoice_items: args.add_invoice_items,
        application_fee_percent: args.application_fee_percent,
        automatic_tax: args.automatic_tax,
        on_behalf_of: args.on_behalf_of,
        invoice_settings: args.invoice_settings,
        default_source: args.default_source,
        billing_thresholds: args.billing_thresholds,
        cancellation_details: args.cancellation_details,
        trial_from_plan: args.trial_from_plan,
        expand: args.expand,
    });

    // Stripe's documented idiom to RESUME collection is `pause_collection: ''` — the one
    // empty value that must survive compaction (like metadata's delete-key idiom).
    if (args.pause_collection === '') (params as Record<string, any>).pause_collection = '';

    return plainifyStripeDecimals(
        await stripeClient.subscriptions.update(args.id, params)
    );
});

global.registerAction('stripe/subscriptions-retrieve', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const stripeClient = new Stripe(context.connection?.secretApiKey);

    return plainifyStripeDecimals(
        await stripeClient.subscriptions.retrieve(
        args.id,
        compactStripeParams({
            expand: args.expand,
        })
    )
    );
});

global.registerAction('stripe/subscriptions-list', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const stripeClient = new Stripe(context.connection?.secretApiKey);

    return plainifyStripeDecimals(
        await stripeClient.subscriptions.list(
        compactStripeParams({
            customer: args.customer,
            customer_account: args.customer_account,
            price: args.price,
            status: args.status,
            limit: args.limit,
            starting_after: args.starting_after,
            ending_before: args.ending_before,
            collection_method: args.collection_method,
            created: args.created,
            current_period_start: args.current_period_start,
            current_period_end: args.current_period_end,
            automatic_tax: args.automatic_tax,
            test_clock: args.test_clock,
            expand: args.expand,
        })
    )
    );
});

global.registerAction('stripe/subscriptions-cancel', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const stripeClient = new Stripe(context.connection?.secretApiKey);

    return plainifyStripeDecimals(
        await stripeClient.subscriptions.cancel(
        args.id,
        compactStripeParams({
            invoice_now: args.invoice_now,
            prorate: args.prorate,
            cancellation_details: args.cancellation_details,
            expand: args.expand,
        })
    )
    );
});

global.registerAction('stripe/subscriptions-migrate', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const stripeClient = new Stripe(context.connection?.secretApiKey);

    return plainifyStripeDecimals(
        await stripeClient.subscriptions.migrate(
        args.subscription,
        compactStripeParams({
            billing_mode: args.billing_mode,
        })
    )
    );
});

global.registerAction('stripe/subscriptions-resume', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const stripeClient = new Stripe(context.connection?.secretApiKey);

    return plainifyStripeDecimals(
        await stripeClient.subscriptions.resume(
        args.subscription,
        compactStripeParams({
            billing_cycle_anchor: args.billing_cycle_anchor,
            proration_behavior: args.proration_behavior,
            proration_date: args.proration_date,
            expand: args.expand,
        })
    )
    );
});

global.registerAction('stripe/subscriptions-search', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const stripeClient = new Stripe(context.connection?.secretApiKey);

    return plainifyStripeDecimals(
        await stripeClient.subscriptions.search(
        compactStripeParams({
            query: args.query,
            limit: args.limit,
            page: args.page,
            expand: args.expand,
        })
    )
    );
});
