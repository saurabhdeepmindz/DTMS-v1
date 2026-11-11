import { createTrackClient } from './customerio.utils.ts';

global.registerAction('customerio/track-identify', async ({ args }: ActionParams, context: ActionContext) => {
    const cio = createTrackClient(context.connection);

    return await cio.identify(args.customer_id, args.data);
});

global.registerAction('customerio/track-event', async ({ args }: ActionParams, context: ActionContext) => {
    const cio = createTrackClient(context.connection);

    return await cio.track(args.customer_id, args.data);
});

global.registerAction('customerio/track-anonymous', async ({ args }: ActionParams, context: ActionContext) => {
    const cio = createTrackClient(context.connection);

    return await cio.trackAnonymous(args.anonymous_id, args.data);
});

global.registerAction('customerio/track-destroy', async ({ args }: ActionParams, context: ActionContext) => {
    const cio = createTrackClient(context.connection);

    return await cio.destroy(args.customer_id);
});

global.registerAction('customerio/track-add-device', async ({ args }: ActionParams, context: ActionContext) => {
    const cio = createTrackClient(context.connection);

    return await cio.addDevice(args.customer_id, args.device_id, args.platform, args.data);
});

global.registerAction('customerio/track-delete-device', async ({ args }: ActionParams, context: ActionContext) => {
    const cio = createTrackClient(context.connection);

    return await cio.deleteDevice(args.customer_id, args.device_token);
});

global.registerAction('customerio/track-suppress', async ({ args }: ActionParams, context: ActionContext) => {
    const cio = createTrackClient(context.connection);

    return await cio.suppress(args.customer_id);
});

global.registerAction('customerio/track-unsuppress', async ({ args }: ActionParams, context: ActionContext) => {
    const cio = createTrackClient(context.connection);

    return await cio.unsuppress(args.customer_id);
});

global.registerAction('customerio/track-merge-customers', async ({ args }: ActionParams, context: ActionContext) => {
    const cio = createTrackClient(context.connection);

    return await cio.mergeCustomers(args.primary_id_type, args.primary_id, args.secondary_id_type, args.secondary_id);
});
