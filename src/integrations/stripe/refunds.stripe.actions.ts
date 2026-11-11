import Stripe from 'stripe';
import { compactStripeParams, plainifyStripeDecimals } from './stripe.utils.ts';

global.registerAction('stripe/refunds-create', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const stripeClient = new Stripe(context.connection?.secretApiKey);

    return plainifyStripeDecimals(
        await stripeClient.refunds.create(compactStripeParams({
        charge: args.charge,
        payment_intent: args.payment_intent,
        amount: args.amount,
        reason: args.reason,
        metadata: args.metadata,
        instructions_email: args.instructions_email,
        refund_application_fee: args.refund_application_fee,
        reverse_transfer: args.reverse_transfer,
        expand: args.expand,
    }))
    );
});

global.registerAction('stripe/refunds-update', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const stripeClient = new Stripe(context.connection?.secretApiKey);

    return plainifyStripeDecimals(
        await stripeClient.refunds.update(args.id, compactStripeParams({
        metadata: args.metadata,
        expand: args.expand,
    }))
    );
});

global.registerAction('stripe/refunds-retrieve', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const stripeClient = new Stripe(context.connection?.secretApiKey);

    return plainifyStripeDecimals(
        await stripeClient.refunds.retrieve(args.id, compactStripeParams({
        expand: args.expand,
    }))
    );
});

global.registerAction('stripe/refunds-list', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const stripeClient = new Stripe(context.connection?.secretApiKey);

    return plainifyStripeDecimals(
        await stripeClient.refunds.list(compactStripeParams({
        charge: args.charge,
        payment_intent: args.payment_intent,
        limit: args.limit,
        starting_after: args.starting_after,
        ending_before: args.ending_before,
        created: args.created,
        expand: args.expand,
    }))
    );
});

global.registerAction('stripe/refunds-cancel', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const stripeClient = new Stripe(context.connection?.secretApiKey);

    return plainifyStripeDecimals(
        await stripeClient.refunds.cancel(args.id, compactStripeParams({
        expand: args.expand,
    }))
    );
});
