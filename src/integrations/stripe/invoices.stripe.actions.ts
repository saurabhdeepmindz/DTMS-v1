import Stripe from 'stripe';
import { compactStripeParams, plainifyStripeDecimals } from './stripe.utils.ts';

global.registerAction('stripe/invoices-delete', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const stripeClient = new Stripe(context.connection?.secretApiKey);

    return plainifyStripeDecimals(
        await stripeClient.invoices.del(args.id)
    );
});

global.registerAction('stripe/invoices-create', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const stripeClient = new Stripe(context.connection?.secretApiKey);

    return plainifyStripeDecimals(
        await stripeClient.invoices.create(
        compactStripeParams({
            customer: args.customer,
            auto_advance: args.auto_advance,
            collection_method: args.collection_method,
            description: args.description,
            days_until_due: args.days_until_due,
            due_date: args.due_date,
            metadata: args.metadata,
            subscription: args.subscription,
            account_tax_ids: args.account_tax_ids,
            application_fee_amount: args.application_fee_amount,
            currency: args.currency,
            custom_fields: args.custom_fields,
            default_payment_method: args.default_payment_method,
            default_source: args.default_source,
            default_tax_rates: args.default_tax_rates,
            discounts: args.discounts,
            footer: args.footer,
            from_invoice: args.from_invoice,
            pending_invoice_items_behavior: args.pending_invoice_items_behavior,
            rendering: args.rendering,
            statement_descriptor: args.statement_descriptor,
            transfer_data: args.transfer_data,
            automatically_finalizes_at: args.automatically_finalizes_at,
            automatic_tax: args.automatic_tax,
            effective_at: args.effective_at,
            issuer: args.issuer,
            number: args.number,
            on_behalf_of: args.on_behalf_of,
            payment_settings: args.payment_settings,
            shipping_cost: args.shipping_cost,
            shipping_details: args.shipping_details,
            customer_account: args.customer_account,
            expand: args.expand,
        })
    )
    );
});

global.registerAction('stripe/invoices-preview-create', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const stripeClient = new Stripe(context.connection?.secretApiKey);

    return plainifyStripeDecimals(
        await stripeClient.invoices.createPreview(
        compactStripeParams({
            customer: args.customer,
            subscription: args.subscription,
            subscription_details: args.subscription_details,
            automatic_tax: args.automatic_tax,
            currency: args.currency,
            discounts: args.discounts,
            invoice_items: args.invoice_items,
            issuer: args.issuer,
            on_behalf_of: args.on_behalf_of,
            schedule: args.schedule,
            schedule_details: args.schedule_details,
            customer_details: args.customer_details,
            expand: args.expand,
        })
    )
    );
});

global.registerAction('stripe/invoices-update', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const stripeClient = new Stripe(context.connection?.secretApiKey);

    return plainifyStripeDecimals(
        await stripeClient.invoices.update(
        args.id,
        compactStripeParams({
            auto_advance: args.auto_advance,
            collection_method: args.collection_method,
            description: args.description,
            days_until_due: args.days_until_due,
            due_date: args.due_date,
            metadata: args.metadata,
            account_tax_ids: args.account_tax_ids,
            application_fee_amount: args.application_fee_amount,
            custom_fields: args.custom_fields,
            default_payment_method: args.default_payment_method,
            default_source: args.default_source,
            default_tax_rates: args.default_tax_rates,
            discounts: args.discounts,
            footer: args.footer,
            on_behalf_of: args.on_behalf_of,
            payment_settings: args.payment_settings,
            rendering: args.rendering,
            statement_descriptor: args.statement_descriptor,
            transfer_data: args.transfer_data,
            automatically_finalizes_at: args.automatically_finalizes_at,
            automatic_tax: args.automatic_tax,
            effective_at: args.effective_at,
            issuer: args.issuer,
            number: args.number,
            shipping_cost: args.shipping_cost,
            shipping_details: args.shipping_details,
            expand: args.expand,
        })
    )
    );
});

global.registerAction('stripe/invoices-retrieve', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const stripeClient = new Stripe(context.connection?.secretApiKey);

    return plainifyStripeDecimals(
        await stripeClient.invoices.retrieve(
        args.id,
        compactStripeParams({
            expand: args.expand,
        })
    )
    );
});

global.registerAction('stripe/invoices-list', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const stripeClient = new Stripe(context.connection?.secretApiKey);

    return plainifyStripeDecimals(
        await stripeClient.invoices.list(
        compactStripeParams({
            customer: args.customer,
            status: args.status,
            subscription: args.subscription,
            limit: args.limit,
            starting_after: args.starting_after,
            ending_before: args.ending_before,
            created: args.created,
            due_date: args.due_date,
            collection_method: args.collection_method,
            expand: args.expand,
        })
    )
    );
});

global.registerAction('stripe/invoices-attach-payment', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const stripeClient = new Stripe(context.connection?.secretApiKey);

    return plainifyStripeDecimals(
        await stripeClient.invoices.attachPayment(
        args.id,
        compactStripeParams({
            payment_intent: args.payment_intent,
        })
    )
    );
});

global.registerAction('stripe/invoices-list-line-items', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const stripeClient = new Stripe(context.connection?.secretApiKey);

    return plainifyStripeDecimals(
        await stripeClient.invoices.listLineItems(
        args.id,
        compactStripeParams({
            limit: args.limit,
            starting_after: args.starting_after,
            ending_before: args.ending_before,
            expand: args.expand,
        })
    )
    );
});

global.registerAction('stripe/invoices-add-lines', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const stripeClient = new Stripe(context.connection?.secretApiKey);

    return plainifyStripeDecimals(
        await stripeClient.invoices.addLines(
        args.id,
        compactStripeParams({
            lines: args.lines,
            invoice_metadata: args.invoice_metadata,
            expand: args.expand,
        })
    )
    );
});

global.registerAction('stripe/invoices-remove-lines', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const stripeClient = new Stripe(context.connection?.secretApiKey);

    return plainifyStripeDecimals(
        await stripeClient.invoices.removeLines(
        args.id,
        compactStripeParams({
            lines: args.lines,
            invoice_metadata: args.invoice_metadata,
            expand: args.expand,
        })
    )
    );
});

global.registerAction('stripe/invoices-update-lines', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const stripeClient = new Stripe(context.connection?.secretApiKey);

    return plainifyStripeDecimals(
        await stripeClient.invoices.updateLines(
        args.id,
        compactStripeParams({
            lines: args.lines,
            invoice_metadata: args.invoice_metadata,
            expand: args.expand,
        })
    )
    );
});

global.registerAction('stripe/invoices-update-line-item', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const stripeClient = new Stripe(context.connection?.secretApiKey);

    return plainifyStripeDecimals(
        await stripeClient.invoices.updateLineItem(
        args.invoice_id,
        args.id,
        compactStripeParams({
            amount: args.amount,
            description: args.description,
            discountable: args.discountable,
            discounts: args.discounts,
            expand: args.expand,
            metadata: args.metadata,
            period: args.period,
            price_data: args.price_data,
            pricing: args.pricing,
            quantity: args.quantity,
            tax_amounts: args.tax_amounts,
            tax_rates: args.tax_rates,
        })
    )
    );
});

global.registerAction('stripe/invoices-finalize', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const stripeClient = new Stripe(context.connection?.secretApiKey);

    return plainifyStripeDecimals(
        await stripeClient.invoices.finalizeInvoice(
        args.id,
        compactStripeParams({
            auto_advance: args.auto_advance,
            expand: args.expand,
        })
    )
    );
});

global.registerAction('stripe/invoices-mark-uncollectible', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const stripeClient = new Stripe(context.connection?.secretApiKey);

    return plainifyStripeDecimals(
        await stripeClient.invoices.markUncollectible(
        args.id,
        compactStripeParams({
            expand: args.expand,
        })
    )
    );
});

global.registerAction('stripe/invoices-pay', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const stripeClient = new Stripe(context.connection?.secretApiKey);

    return plainifyStripeDecimals(
        await stripeClient.invoices.pay(
        args.id,
        compactStripeParams({
            forgive: args.forgive,
            off_session: args.off_session,
            paid_out_of_band: args.paid_out_of_band,
            payment_method: args.payment_method,
            source: args.source,
            mandate: args.mandate,
            expand: args.expand,
        })
    )
    );
});

global.registerAction('stripe/invoices-search', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const stripeClient = new Stripe(context.connection?.secretApiKey);

    return plainifyStripeDecimals(
        await stripeClient.invoices.search(
        compactStripeParams({
            query: args.query,
            limit: args.limit,
            page: args.page,
            expand: args.expand,
        })
    )
    );
});

global.registerAction('stripe/invoices-send', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const stripeClient = new Stripe(context.connection?.secretApiKey);

    return plainifyStripeDecimals(
        await stripeClient.invoices.sendInvoice(
        args.id,
        compactStripeParams({
            expand: args.expand,
        })
    )
    );
});

global.registerAction('stripe/invoices-void', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const stripeClient = new Stripe(context.connection?.secretApiKey);

    return plainifyStripeDecimals(
        await stripeClient.invoices.voidInvoice(
        args.id,
        compactStripeParams({
            expand: args.expand,
        })
    )
    );
});
