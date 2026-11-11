import Stripe from 'stripe';
import { compactStripeParams, plainifyStripeDecimals } from './stripe.utils.ts';

global.registerTableView('stripe', async (connection: ConnectionConfig, table: TableConfig, view: ViewConfig) => {
    const result = await fetchData(connection, table, view);

    return {
        // *_decimal fields arrive as SDK Decimal instances — rows must be plain JSON.
        data: plainifyStripeDecimals(result.data),
        metadata: {
            limit: view.limit || 10,
            offset: view._action === 'search' ? view.offset || 1 : view.offset || null,
            nextOffset: result.has_more
                ? view._action === 'search'
                    ? (view.offset || 1) + 1
                    : result.data?.[result.data.length - 1]?.id
                : null,
        },
    };
});

async function fetchData(connection: ConnectionConfig, table: TableConfig, view: ViewConfig) {
    const stripeClient = new Stripe(connection?.secretApiKey);

    if (view._action === 'search') {
        return await stripeClient[table.resource].search({
            query: view.query,
            limit: view.limit,
            page: view.offset,
            expand: view.expand,
        });
    }

    switch (table.resource) {
        case 'products': {
            return await stripeClient.products.list(
                compactStripeParams({
                    active: view.active,
                    limit: view.limit,
                    // numeric-offset callers (editor test / MCP fetch) send 0 for the first
                    // page — a Stripe cursor is a product id, so 0/'0' means "no cursor"
                    starting_after: view.offset === 0 || view.offset === '0' ? undefined : view.offset,
                    created: view.created,
                    ids: view.ids,
                    shippable: view.shippable,
                    url: view.url,
                    expand: view.expand,
                })
            );
        }
        case 'prices': {
            return await stripeClient.prices.list(
                compactStripeParams({
                    active: view.active,
                    currency: view.currency,
                    product: view.product,
                    type: view.type,
                    limit: view.limit,
                    // numeric-offset callers (editor test / MCP fetch) send 0 for the first
                    // page — a Stripe cursor is a price id, so 0/'0' means "no cursor"
                    starting_after: view.offset === 0 || view.offset === '0' ? undefined : view.offset,
                    created: view.created,
                    recurring: view.recurring,
                    expand: view.expand,
                })
            );
        }
        case 'customers': {
            return await stripeClient.customers.list(
                compactStripeParams({
                    email: view.email,
                    limit: view.limit,
                    // numeric-offset callers (editor test / MCP fetch) send 0 for the first
                    // page — a Stripe cursor is a customer id, so 0/'0' means "no cursor"
                    starting_after: view.offset === 0 || view.offset === '0' ? undefined : view.offset,
                    created: view.created,
                    expand: view.expand,
                })
            );
        }
        case 'invoices': {
            return await stripeClient.invoices.list(
                compactStripeParams({
                    customer: view.customer,
                    status: view.status,
                    subscription: view.subscription,
                    limit: view.limit,
                    // numeric-offset callers (editor test / MCP fetch) send 0 for the first
                    // page — a Stripe cursor is an invoice id, so 0/'0' means "no cursor"
                    starting_after: view.offset === 0 || view.offset === '0' ? undefined : view.offset,
                    created: view.created,
                    due_date: view.due_date,
                    expand: view.expand,
                })
            );
        }
        case 'subscriptions': {
            return await stripeClient.subscriptions.list(
                compactStripeParams({
                    customer: view.customer,
                    price: view.price,
                    status: view.status,
                    limit: view.limit,
                    // numeric-offset callers (editor test / MCP fetch) send 0 for the first
                    // page — a Stripe cursor is a subscription id, so 0/'0' means "no cursor"
                    starting_after: view.offset === 0 || view.offset === '0' ? undefined : view.offset,
                    collection_method: view.collection_method,
                    created: view.created,
                    current_period_start: view.current_period_start,
                    current_period_end: view.current_period_end,
                    expand: view.expand,
                })
            );
        }
        case 'checkout_sessions': {
            return await stripeClient.checkout.sessions.list(
                compactStripeParams({
                    customer: view.customer,
                    payment_intent: view.payment_intent,
                    subscription: view.subscription,
                    payment_link: view.payment_link,
                    status: view.status,
                    limit: view.limit,
                    // numeric-offset callers (editor test / MCP fetch) send 0 for the first
                    // page — a Stripe cursor is a session id, so 0/'0' means "no cursor"
                    starting_after: view.offset === 0 || view.offset === '0' ? undefined : view.offset,
                    created: view.created,
                    expand: view.expand,
                })
            );
        }
        case 'payments': {
            return await stripeClient.paymentIntents.list(
                compactStripeParams({
                    customer: view.customer,
                    limit: view.limit,
                    // numeric-offset callers (editor test / MCP fetch) send 0 for the first
                    // page — a Stripe cursor is a payment intent id, so 0/'0' means "no cursor"
                    starting_after: view.offset === 0 || view.offset === '0' ? undefined : view.offset,
                    created: view.created,
                    expand: view.expand,
                })
            );
        }
        default:
            throw new Error(`Unsupported Stripe type: ${table.resource}`);
    }
}
