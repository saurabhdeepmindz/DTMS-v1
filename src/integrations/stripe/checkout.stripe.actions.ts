import Stripe from 'stripe';
import { getPageUrl } from '../utils.ts';
import { compactStripeParams, plainifyStripeDecimals } from './stripe.utils.ts';

global.registerAction('stripe/checkout-sessions-create', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const stripeClient = new Stripe(context.connection?.secretApiKey);

    const return_url = getPageUrl(args.return_page);
    const cancel_url = getPageUrl(args.cancel_page);
    const success_url = getPageUrl(args.success_page);

    return plainifyStripeDecimals(
        await stripeClient.checkout.sessions.create(
        compactStripeParams({
            line_items: args.line_items,
            mode: args.mode,
            success_url,
            cancel_url,
            customer: args.customer,
            customer_email: args.customer_email,
            payment_method_types: args.payment_method_types,
            allow_promotion_codes: args.allow_promotion_codes,
            billing_address_collection: args.billing_address_collection,
            currency: args.currency,
            phone_number_collection: args.phone_number_collection,
            shipping_address_collection: args.shipping_address_collection,
            discounts: args.discounts,
            expires_at: args.expires_at,
            locale: args.locale,
            metadata: args.metadata,
            payment_intent_data: args.payment_intent_data,
            shipping_options: args.shipping_options,
            submit_type: args.submit_type,
            subscription_data: args.subscription_data,
            tax_id_collection: args.tax_id_collection,
            after_expiration: args.after_expiration,
            automatic_tax: args.automatic_tax,
            consent_collection: args.consent_collection,
            custom_fields: args.custom_fields,
            custom_text: args.custom_text,
            customer_creation: args.customer_creation,
            invoice_creation: args.invoice_creation,
            adaptive_pricing: args.adaptive_pricing,
            branding_settings: args.branding_settings,
            client_reference_id: args.client_reference_id,
            customer_account: args.customer_account,
            customer_update: args.customer_update,
            excluded_payment_method_types: args.excluded_payment_method_types,
            name_collection: args.name_collection,
            optional_items: args.optional_items,
            origin_context: args.origin_context,
            payment_method_collection: args.payment_method_collection,
            payment_method_configuration: args.payment_method_configuration,
            permissions: args.permissions,
            payment_method_data: args.payment_method_data,
            payment_method_options: args.payment_method_options,
            redirect_on_completion: args.redirect_on_completion,
            return_url,
            saved_payment_method_options: args.saved_payment_method_options,
            ui_mode: args.ui_mode,
            integration_identifier: args.integration_identifier,
            expand: args.expand,
        })
    )
    );
});

global.registerAction('stripe/checkout-sessions-update', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const stripeClient = new Stripe(context.connection?.secretApiKey);

    return plainifyStripeDecimals(
        await stripeClient.checkout.sessions.update(
        args.id,
        compactStripeParams({
            metadata: args.metadata,
            collected_information: args.collected_information,
            shipping_options: args.shipping_options,
            expand: args.expand,
        })
    )
    );
});

global.registerAction('stripe/checkout-sessions-retrieve', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const stripeClient = new Stripe(context.connection?.secretApiKey);

    return plainifyStripeDecimals(
        await stripeClient.checkout.sessions.retrieve(
        args.id,
        compactStripeParams({
            expand: args.expand,
        })
    )
    );
});

global.registerAction(
    'stripe/checkout-sessions-line-items-list',
    async ({ args = {} }: ActionParams, context: ActionContext) => {
        const stripeClient = new Stripe(context.connection?.secretApiKey);

        return plainifyStripeDecimals(
        await stripeClient.checkout.sessions.listLineItems(
            args.id,
            compactStripeParams({
                limit: args.limit,
                starting_after: args.starting_after,
                ending_before: args.ending_before,
                expand: args.expand,
            })
        )
    );
    }
);

global.registerAction('stripe/checkout-sessions-list', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const stripeClient = new Stripe(context.connection?.secretApiKey);

    return plainifyStripeDecimals(
        await stripeClient.checkout.sessions.list(
        compactStripeParams({
            customer: args.customer,
            customer_account: args.customer_account,
            customer_details: args.customer_details,
            payment_intent: args.payment_intent,
            payment_link: args.payment_link,
            subscription: args.subscription,
            status: args.status,
            limit: args.limit,
            starting_after: args.starting_after,
            ending_before: args.ending_before,
            created: args.created,
            expand: args.expand,
        })
    )
    );
});

global.registerAction('stripe/checkout-sessions-expire', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const stripeClient = new Stripe(context.connection?.secretApiKey);

    return plainifyStripeDecimals(
        await stripeClient.checkout.sessions.expire(
        args.id,
        compactStripeParams({
            expand: args.expand,
        })
    )
    );
});
