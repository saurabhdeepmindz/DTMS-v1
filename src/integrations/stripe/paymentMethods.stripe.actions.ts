import Stripe from 'stripe';

global.registerAction('stripe/payment-methods-create', async ({ args }: ActionParams, context: ActionContext) => {
    const stripeClient = new Stripe(context.connection?.secretApiKey);

    return await stripeClient.paymentMethods.create({
        type: args.type,
        card: args.card,
        billing_details: args.billing_details,
        metadata: args.metadata,
        acss_debit: args.acss_debit,
        affirm: args.affirm,
        afterpay_clearpay: args.afterpay_clearpay,
        alipay: args.alipay,
        au_becs_debit: args.au_becs_debit,
        bacs_debit: args.bacs_debit,
        bancontact: args.bancontact,
        blik: args.blik,
        boleto: args.boleto,
        customer_balance: args.customer_balance,
        eps: args.eps,
        fpx: args.fpx,
        giropay: args.giropay,
        grabpay: args.grabpay,
        ideal: args.ideal,
        interac_present: args.interac_present,
        klarna: args.klarna,
        konbini: args.konbini,
        link: args.link,
        oxxo: args.oxxo,
        p24: args.p24,
        paynow: args.paynow,
        pix: args.pix,
        promptpay: args.promptpay,
        radar_options: args.radar_options,
        sepa_debit: args.sepa_debit,
        sofort: args.sofort,
        us_bank_account: args.us_bank_account,
        wechat_pay: args.wechat_pay,
        allow_redisplay: args.allow_redisplay,
        alma: args.alma,
        amazon_pay: args.amazon_pay,
        billie: args.billie,
        cashapp: args.cashapp,
        crypto: args.crypto,
        custom: args.custom,
        kakao_pay: args.kakao_pay,
        kr_card: args.kr_card,
        mb_way: args.mb_way,
        mobilepay: args.mobilepay,
        multibanco: args.multibanco,
        naver_pay: args.naver_pay,
        nz_bank_account: args.nz_bank_account,
        pay_by_bank: args.pay_by_bank,
        payco: args.payco,
        paypal: args.paypal,
        payto: args.payto,
        revolut_pay: args.revolut_pay,
        samsung_pay: args.samsung_pay,
        satispay: args.satispay,
        swish: args.swish,
        twint: args.twint,
        zip: args.zip,
    });
});

global.registerAction('stripe/payment-methods-update', async ({ args }: ActionParams, context: ActionContext) => {
    const stripeClient = new Stripe(context.connection?.secretApiKey);

    return await stripeClient.paymentMethods.update(args.payment_method, {
        billing_details: args.billing_details,
        metadata: args.metadata,
        card: args.card,
        us_bank_account: args.us_bank_account,
        allow_redisplay: args.allow_redisplay,
        expand: args.expand,
    });
});

global.registerAction(
    'stripe/customers-payment-methods-retrieve',
    async ({ args }: ActionParams, context: ActionContext) => {
        const stripeClient = new Stripe(context.connection?.secretApiKey);

        return await stripeClient.customers.retrievePaymentMethod(args.customer, args.payment_method, {
            expand: args.expand,
        });
    }
);

global.registerAction('stripe/payment-methods-retrieve', async ({ args }: ActionParams, context: ActionContext) => {
    const stripeClient = new Stripe(context.connection?.secretApiKey);

    return await stripeClient.paymentMethods.retrieve(args.id, {
        expand: args.expand,
    });
});

global.registerAction(
    'stripe/customers-payment-methods-list',
    async ({ args }: ActionParams, context: ActionContext) => {
        const stripeClient = new Stripe(context.connection?.secretApiKey);

        return await stripeClient.customers.listPaymentMethods(args.customer, {
            type: args.type,
            limit: args.limit,
            starting_after: args.starting_after,
            ending_before: args.ending_before,
            expand: args.expand,
        });
    }
);

global.registerAction('stripe/payment-methods-list', async ({ args }: ActionParams, context: ActionContext) => {
    const stripeClient = new Stripe(context.connection?.secretApiKey);

    return await stripeClient.paymentMethods.list({
        customer: args.customer,
        type: args.type,
        limit: args.limit,
        starting_after: args.starting_after,
        ending_before: args.ending_before,
        expand: args.expand,
    });
});

global.registerAction('stripe/payment-methods-attach', async ({ args }: ActionParams, context: ActionContext) => {
    const stripeClient = new Stripe(context.connection?.secretApiKey);

    return await stripeClient.paymentMethods.attach(args.id, {
        customer: args.customer,
        expand: args.expand,
    });
});

global.registerAction('stripe/payment-methods-detach', async ({ args }: ActionParams, context: ActionContext) => {
    const stripeClient = new Stripe(context.connection?.secretApiKey);

    return await stripeClient.paymentMethods.detach(args.id, {
        expand: args.expand,
    });
});
