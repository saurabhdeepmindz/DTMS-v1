import { getHeaders, buildQueryString } from './apitemplate.utils.ts';

const APITEMPLATE_API_BASE = 'https://rest.apitemplate.io/v2';

global.registerAction('apitemplate/create-pdf', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const params = {
        template_id: args.template_id,
        export_type: args.export_type,
        export_in_base64: args.export_in_base64,
        expiration: args.expiration,
        output_html: args.output_html,
        output_format: args.output_format,
        filename: args.filename,
        direct_download: args.direct_download,
        cloud_storage: args.cloud_storage,
        load_data_from: args.load_data_from,
        extract_link: args.extract_link,
        generation_delay: args.generation_delay,
        image_resample_res: args.image_resample_res,
        resize_images: args.resize_images,
        resize_max_width: args.resize_max_width,
        resize_max_height: args.resize_max_height,
        resize_format: args.resize_format,
        postaction_s3_filekey: args.postaction_s3_filekey,
        postaction_s3_bucket: args.postaction_s3_bucket,
        postaction_enabled: args.postaction_enabled,
        meta: args.meta,
        async: args.async,
        webhook: args.webhook,
        webhook_url: args.webhook_url,
        webhook_method: args.webhook_method,
        webhook_headers: args.webhook_headers,
    };

    const queryString = buildQueryString(params);
    const response = await fetch(`${APITEMPLATE_API_BASE}/create-pdf${queryString}`, {
        method: 'POST',
        headers: getHeaders(context.connection?.apiKey),
        body: JSON.stringify(args.data),
    });
    const data = await response.json();

    if (!response.ok) throw data;
    return data;
});

global.registerAction('apitemplate/create-image', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const params = {
        template_id: args.template_id,
        output_image_type: args.output_image_type,
        expiration: args.expiration,
        cloud_storage: args.cloud_storage,
        generation_delay: args.generation_delay,
        resize_images: args.resize_images,
        resize_max_width: args.resize_max_width,
        resize_max_height: args.resize_max_height,
        resize_format: args.resize_format,
        postaction_s3_filekey: args.postaction_s3_filekey,
        postaction_s3_bucket: args.postaction_s3_bucket,
        postaction_enabled: args.postaction_enabled,
        meta: args.meta,
    };

    const queryString = buildQueryString(params);
    const response = await fetch(`${APITEMPLATE_API_BASE}/create-image${queryString}`, {
        method: 'POST',
        headers: getHeaders(context.connection?.apiKey),
        body: JSON.stringify(args.data),
    });
    const data = await response.json();

    if (!response.ok) throw data;
    return data;
});

global.registerAction('apitemplate/merge-pdfs', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const params = {
        postaction_s3_filekey: args.postaction_s3_filekey,
        postaction_s3_bucket: args.postaction_s3_bucket,
        postaction_enabled: args.postaction_enabled,
        meta: args.meta,
    };

    const body = {
        urls: args.urls,
        export_type: args.export_type,
        expiration: args.expiration,
        cloud_storage: args.cloud_storage,
    };

    const queryString = buildQueryString(params);
    const response = await fetch(`${APITEMPLATE_API_BASE}/merge-pdfs${queryString}`, {
        method: 'POST',
        headers: getHeaders(context.connection?.apiKey),
        body: JSON.stringify(body),
    });
    const data = await response.json();

    if (!response.ok) throw data;
    return data;
});
