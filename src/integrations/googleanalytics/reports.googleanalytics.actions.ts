import {
    getAnalyticsDataClient,
    normalizePropertyId,
    zipReportRows,
    buildDimensionFilter,
    assertFilterFieldsAreDimensions,
    assertDateRange,
    buildOrderBys,
    toArray,
    toBoolean,
    toRawFilter,
    toStartMinutesAgo,
    toWholeNumber,
} from './googleanalytics.utils.ts';

global.registerAction('googleanalytics/reports-run', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getAnalyticsDataClient(context.connection);
    const propertyId = normalizePropertyId(args.propertyId);

    const dimensions: string[] = toArray<string>(args.dimensions);
    const metrics: string[] = toArray<string>(args.metrics);

    const startDate = args.startDate || '28daysAgo';
    const endDate = args.endDate || 'yesterday';
    // G-05 pre-flight: a range running backwards is a predictable mistake (End Date defaults
    // to yesterday) — name both dates instead of relaying Google's 400.
    assertDateRange(startDate, endDate);

    const advancedFilter = toRawFilter(args.advancedFilter);
    // G9 pre-flight: simple filter rows may only reference selected dimensions.
    if (!advancedFilter) assertFilterFieldsAreDimensions(args.filters, dimensions);
    const dimensionFilter = buildDimensionFilter(args.filters, advancedFilter);
    const metricFilter = toRawFilter(args.metricFilter);

    const orderBys = buildOrderBys(args.orderBys, dimensions, metrics);

    // G-02: reject "abc" or -1 here with the field named, instead of Google's TYPE_INT64 500.
    const limit = toWholeNumber(args.limit, 'limit', { min: 1 });
    const offset = toWholeNumber(args.offset, 'offset');

    const response = await client.properties.runReport({
        property: `properties/${propertyId}`,
        requestBody: {
            dimensions: dimensions.map(name => ({ name })),
            metrics: metrics.map(name => ({ name })),
            dateRanges: [{ startDate, endDate }],
            dimensionFilter,
            metricFilter,
            orderBys,
            limit: limit != null ? String(limit) : undefined,
            offset: offset != null ? String(offset) : undefined,
            // G-04: a bound "false" is a string, and strings are truthy — coerce strictly.
            keepEmptyRows:
                args.keepEmptyRows === undefined || args.keepEmptyRows === null || args.keepEmptyRows === ''
                    ? undefined
                    : toBoolean(args.keepEmptyRows),
            returnPropertyQuota: true,
        },
    });

    return {
        rows: zipReportRows(response.data),
        rowCount: Number(response.data.rowCount || 0),
        ...(response.data.totals ? { totals: response.data.totals } : {}),
        propertyQuota: response.data.propertyQuota,
    };
});

global.registerAction(
    'googleanalytics/reports-run-realtime',
    async ({ args = {} }: ActionParams, context: ActionContext) => {
        const client = getAnalyticsDataClient(context.connection);
        const propertyId = normalizePropertyId(args.propertyId);

        const dimensions: string[] = toArray<string>(args.dimensions);
        const metrics: string[] = toArray<string>(args.metrics);

        const limit = toWholeNumber(args.limit, 'limit', { min: 1 });
        // "Last N minutes" = N one-minute buckets, minutesAgo 0..N-1 (G-04); 30 stays within
        // the standard-property cap of 29.
        const startMinutesAgo = toStartMinutesAgo(args.minutesLookback);

        const response = await client.properties.runRealtimeReport({
            property: `properties/${propertyId}`,
            requestBody: {
                dimensions: dimensions.map(name => ({ name })),
                metrics: metrics.map(name => ({ name })),
                limit: limit != null ? String(limit) : undefined,
                minuteRanges: startMinutesAgo != null ? [{ startMinutesAgo }] : undefined,
            },
        });

        return {
            rows: zipReportRows(response.data),
            rowCount: Number(response.data.rowCount || 0),
        };
    }
);
