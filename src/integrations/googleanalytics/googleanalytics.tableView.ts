import {
    getAnalyticsDataClient,
    normalizePropertyId,
    zipReportRows,
    buildDimensionFilter,
    assertFilterFieldsAreDimensions,
    assertDateRange,
    buildOrderBys,
    clampTableLimit,
    describeGoogleError,
    toArray,
    toRawFilter,
    toWholeNumber,
} from './googleanalytics.utils.ts';

global.registerTableView(
    'googleanalytics',
    async (connection: ConnectionConfig, table: TableConfig, view: ViewConfig) => {
        // Throw on a broken config — an empty result would read as "no rows" and mask it.
        if (!table.propertyId) {
            throw new Error('Google Analytics table is missing its property — set propertyId in the table setup.');
        }
        const metrics: string[] = toArray<string>(table.metrics);
        if (metrics.length === 0) {
            throw new Error('Google Analytics table has no metrics — select at least one metric in the table setup.');
        }

        const client = getAnalyticsDataClient(connection);
        const propertyId = normalizePropertyId(table.propertyId);
        const dimensions: string[] = toArray<string>(table.dimensions);

        const startDate = table.startDate || '28daysAgo';
        const endDate = table.endDate || 'yesterday';
        assertDateRange(startDate, endDate);

        // G-08: the view takes the same raw FilterExpression escape hatches as Run Report, so a
        // table is not limited to AND-ed dimension rows. A non-empty advancedFilter wins over
        // the simple rows, exactly as in the action.
        const advancedFilter = toRawFilter(view.advancedFilter);
        // G9 pre-flight: simple filter rows may only reference selected dimensions.
        if (!advancedFilter) assertFilterFieldsAreDimensions(view.filters, dimensions);
        const dimensionFilter = buildDimensionFilter(view.filters, advancedFilter);
        const metricFilter = toRawFilter(view.metricFilter);
        const orderBys = buildOrderBys(view.orderBys, dimensions, metrics);

        // G-02: the page size is clamped to the 10,000 the editor announces and reported as
        // honored; a non-integer offset is named here instead of surfacing as Google's
        // TYPE_INT64 500. The offset is a NUMERIC row index, not a cursor.
        const limit = clampTableLimit(view.limit);
        const offset = toWholeNumber(view.offset, 'offset') ?? 0;

        let response;
        try {
            response = await client.properties.runReport({
                property: `properties/${propertyId}`,
                requestBody: {
                    dimensions: dimensions.map(name => ({ name })),
                    metrics: metrics.map(name => ({ name })),
                    dateRanges: [{ startDate, endDate }],
                    dimensionFilter,
                    metricFilter,
                    orderBys,
                    limit: String(limit),
                    offset: String(offset),
                },
            });
        } catch (error) {
            // The platform flattens the status to 500 either way; keep Google's own message so
            // an incompatible combination or a bad filter still reads as what it is.
            const detail = describeGoogleError(error);
            if (!detail) throw error;
            throw new Error(detail);
        }

        const rows = zipReportRows(response.data);
        // G10: rowCount is the TOTAL number of matching rows, not the number returned.
        const rowCount = Number(response.data.rowCount || 0);

        return {
            data: rows,
            metadata: {
                limit,
                offset,
                nextOffset: offset + rows.length < rowCount ? offset + rows.length : null,
                // The paginator needs the total to offer random page access — without it the
                // page list only grew as pages were visited (WW-5910 QA, paginator finding).
                // Same key Supabase reports.
                total: rowCount,
            },
        };
    }
);
