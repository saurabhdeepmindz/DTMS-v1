import { getAnalyticsDataClient, normalizePropertyId, toArray } from './googleanalytics.utils.ts';

global.registerAction('googleanalytics/metadata-get', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getAnalyticsDataClient(context.connection);
    const propertyId = normalizePropertyId(args.propertyId);

    const response = await client.properties.getMetadata({
        name: `properties/${propertyId}/metadata`,
    });

    return {
        dimensions: response.data.dimensions || [],
        metrics: response.data.metrics || [],
    };
});

global.registerAction(
    'googleanalytics/compatibility-check',
    async ({ args = {} }: ActionParams, context: ActionContext) => {
        const client = getAnalyticsDataClient(context.connection);
        const propertyId = normalizePropertyId(args.propertyId);

        const dimensions: string[] = toArray<string>(args.dimensions);
        const metrics: string[] = toArray<string>(args.metrics);

        const response = await client.properties.checkCompatibility({
            property: `properties/${propertyId}`,
            requestBody: {
                dimensions: dimensions.map(name => ({ name })),
                metrics: metrics.map(name => ({ name })),
            },
        });

        // Google answers with a verdict for EVERY field on the property (375+ entries —
        // battery finding, WW-5910). Each list is scoped to what the caller named IN THAT
        // LIST; a list left empty keeps Google's full verdict for it, because that is the
        // question being asked — "which dimensions can go with these metrics?" (WW-5910 QA
        // G-01: scoping both lists on either input emptied the one the user wanted).
        const data = response.data;
        return {
            dimensionCompatibilities: dimensions.length
                ? (data.dimensionCompatibilities ?? []).filter(item =>
                      dimensions.includes(item.dimensionMetadata?.apiName ?? '')
                  )
                : (data.dimensionCompatibilities ?? []),
            metricCompatibilities: metrics.length
                ? (data.metricCompatibilities ?? []).filter(item =>
                      metrics.includes(item.metricMetadata?.apiName ?? '')
                  )
                : (data.metricCompatibilities ?? []),
        };
    }
);
