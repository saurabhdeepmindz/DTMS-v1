import Stripe from 'stripe';
import { compactStripeParams, plainifyStripeDecimals } from './stripe.utils.ts';

global.registerAction('stripe/payment-intents-create', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const stripeClient = new Stripe(context.connection?.secretApiKey);

    return plainifyStripeDecimals(await stripeClient.paymentIntents.create(
        compactStripeParams({
            amount: args.amount,
            currency: args.currency,
            customer: args.customer,
            description: args.description,
            payment_method: args.payment_method,
            receipt_email: args.receipt_email,
            automatic_payment_methods: args.automatic_payment_methods,
            metadata: args.metadata,
            confirm: args.confirm,
            capture_method: args.capture_method,
            confirmation_method: args.confirmation_method,
            off_session: args.off_session,
            payment_method_types: args.payment_method_types,
            return_url: args.return_url,
            setup_future_usage: args.setup_future_usage,
            shipping: args.shipping,
            statement_descriptor: args.statement_descriptor,
            statement_descriptor_suffix: args.statement_descriptor_suffix,
            transfer_data: args.transfer_data,
            transfer_group: args.transfer_group,
            use_stripe_sdk: args.use_stripe_sdk,
        })
    ));
});

global.registerAction('stripe/payment-intents-update', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const stripeClient = new Stripe(context.connection?.secretApiKey);

    return plainifyStripeDecimals(await stripeClient.paymentIntents.update(
        args.id,
        compactStripeParams({
            amount: args.amount,
            currency: args.currency,
            customer: args.customer,
            description: args.description,
            payment_method: args.payment_method,
            receipt_email: args.receipt_email,
            metadata: args.metadata,
            capture_method: args.capture_method,
            setup_future_usage: args.setup_future_usage,
            shipping: args.shipping,
            statement_descriptor: args.statement_descriptor,
            statement_descriptor_suffix: args.statement_descriptor_suffix,
            transfer_data: args.transfer_data,
            transfer_group: args.transfer_group,
        })
    ));
});

global.registerAction('stripe/payment-intents-retrieve', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const stripeClient = new Stripe(context.connection?.secretApiKey);

    return plainifyStripeDecimals(await stripeClient.paymentIntents.retrieve(
        args.id,
        compactStripeParams({
            expand: args.expand,
        })
    ));
});

global.registerAction('stripe/payment-intents-list', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const stripeClient = new Stripe(context.connection?.secretApiKey);

    return plainifyStripeDecimals(await stripeClient.paymentIntents.list(
        compactStripeParams({
            customer: args.customer,
            limit: args.limit,
            starting_after: args.starting_after,
            ending_before: args.ending_before,
            created: args.created,
            expand: args.expand,
        })
    ));
});

global.registerAction('stripe/payment-intents-cancel', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const stripeClient = new Stripe(context.connection?.secretApiKey);

    return plainifyStripeDecimals(await stripeClient.paymentIntents.cancel(
        args.id,
        compactStripeParams({
            cancellation_reason: args.cancellation_reason,
            expand: args.expand,
        })
    ));
});

global.registerAction('stripe/payment-intents-capture', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const stripeClient = new Stripe(context.connection?.secretApiKey);

    return plainifyStripeDecimals(await stripeClient.paymentIntents.capture(
        args.id,
        compactStripeParams({
            amount_to_capture: args.amount_to_capture,
            final_capture: args.final_capture,
            metadata: args.metadata,
            statement_descriptor: args.statement_descriptor,
            statement_descriptor_suffix: args.statement_descriptor_suffix,
            transfer_data: args.transfer_data,
            application_fee_amount: args.application_fee_amount,
            expand: args.expand,
        })
    ));
});

global.registerAction('stripe/payment-intents-confirm', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const stripeClient = new Stripe(context.connection?.secretApiKey);

    return plainifyStripeDecimals(await stripeClient.paymentIntents.confirm(
        args.id,
        compactStripeParams({
            payment_method: args.payment_method,
            receipt_email: args.receipt_email,
            return_url: args.return_url,
            setup_future_usage: args.setup_future_usage,
            shipping: args.shipping,
            off_session: args.off_session,
            error_on_requires_action: args.error_on_requires_action,
            capture_method: args.capture_method,
            confirmation_token: args.confirmation_token,
            use_stripe_sdk: args.use_stripe_sdk,
            expand: args.expand,
        })
    ));
});

global.registerAction('stripe/payment-intents-search', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const stripeClient = new Stripe(context.connection?.secretApiKey);

    return plainifyStripeDecimals(await stripeClient.paymentIntents.search(
        compactStripeParams({
            query: args.query,
            limit: args.limit,
            page: args.page,
            expand: args.expand,
        })
    ));
});
