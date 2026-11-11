import {
    anakinFetch,
    buildScrapeSubmitBody,
    clampWaitSeconds,
    normalizeCountry,
    normalizeWebhookUrl,
    pollScrapeJob,
    toArray,
    toBoolean,
} from './anakin.utils.ts';

// Submit async + poll internally: the user gets finished content back, never a job id —
// unless the wait budget runs out, in which case the last poll body (non-terminal status
// + id) is returned for a get-scrape-job follow-up. Scrape failures are HTTP 200 with
// status:"failed" and an `error` string — that body is returned as-is; branch on status.
global.registerAction('anakin/scrape-url', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const body = buildScrapeSubmitBody(args);
    // Resolve the wait budget BEFORE the submit: it needs nothing the POST returns, and
    // validating it afterwards would bill the scrape and then throw away the job id.
    const waitSeconds = clampWaitSeconds(args.maxWaitSeconds, 60);

    const submitted = await anakinFetch(context.connection, '/url-scraper', { method: 'POST', body });

    const jobId = submitted.jobId ?? submitted.id;
    if (!jobId) throw new Error(`Anakin accepted the scrape but returned no job id: ${JSON.stringify(submitted)}`);

    return await pollScrapeJob(context.connection, String(jobId), waitSeconds);
});

global.registerAction('anakin/scrape-urls-batch', async ({ args = {} }: ActionParams, context: ActionContext) => {
    // Check types on the RAW list so the reported position matches what the user typed;
    // blank entries are dropped afterwards and are not an error.
    const rawUrls = toArray<string>(args.urls, 'urls');
    const notAString = rawUrls.findIndex(url => url !== undefined && url !== null && typeof url !== 'string');
    if (notAString !== -1) {
        throw new Error(
            `"urls" entry ${notAString + 1} must be a string, but received ` +
                `${typeof rawUrls[notAString]} (${JSON.stringify(rawUrls[notAString])}).`
        );
    }

    const urls = rawUrls.filter(url => String(url ?? '').trim() !== '');
    if (urls.length < 1 || urls.length > 10) {
        throw new Error(`Batch scrape needs between 1 and 10 URLs — got ${urls.length}.`);
    }

    // The batch endpoint takes no formats/outputSchema/actions — options apply to every URL.
    const useBrowser = toBoolean(args.useBrowser, 'useBrowser');
    const generateJson = toBoolean(args.generateJson, 'generateJson');
    // Resolved before the submit for the same reason as scrape-url: a batch can bill up to
    // 30 credits, and validating the budget afterwards would spend them and then throw.
    const waitSeconds = clampWaitSeconds(args.maxWaitSeconds, 90);
    const country = normalizeCountry(args.country);

    const submitted = await anakinFetch(context.connection, '/url-scraper/batch', {
        method: 'POST',
        body: {
            urls,
            ...(country ? { country } : {}),
            ...(useBrowser ? { useBrowser: true } : {}),
            ...(generateJson ? { generateJson: true } : {}),
        },
    });

    const jobId = submitted.jobId ?? submitted.id;
    if (!jobId) throw new Error(`Anakin accepted the batch but returned no job id: ${JSON.stringify(submitted)}`);

    // Batch parent settles when every URL settles; per-URL failures live inside results[]
    // with the parent still "completed".
    return await pollScrapeJob(context.connection, String(jobId), waitSeconds);
});

global.registerAction('anakin/start-scrape-job', async ({ args = {} }: ActionParams, context: ActionContext) => {
    // snake_case on purpose: `webhook_url` is Anakin's own parameter name, and the field key
    // mirrors the provider's spelling so the docs and the API error messages line up.
    const webhookUrl = normalizeWebhookUrl(args.webhook_url);
    const body = {
        ...buildScrapeSubmitBody(args),
        ...(webhookUrl ? { webhook_url: webhookUrl } : {}),
    };
    return await anakinFetch(context.connection, '/url-scraper', { method: 'POST', body });
});

global.registerAction('anakin/get-scrape-job', async ({ args = {} }: ActionParams, context: ActionContext) => {
    if (!args.jobId) throw new Error('Missing "jobId" — pass the id returned by Start scrape job or Scrape URL.');
    if (typeof args.jobId !== 'string') {
        throw new Error(
            `"jobId" must be a string, but received ${Array.isArray(args.jobId) ? 'array' : typeof args.jobId} ` +
                `(${JSON.stringify(args.jobId)}).`
        );
    }
    return await anakinFetch(context.connection, `/url-scraper/${encodeURIComponent(args.jobId)}`);
});
