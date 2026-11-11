import databaseService from './database.service.ts';
import databaseSchemaService from './schema.service.ts';
import { applyFormulaColumns, prepareFormulaColumns } from './formulaColumns.ts';
import { getFormulaPreviewColumns, getFormulaPreviewRow } from './formulaPreviewRows.ts';
import { prepareFormulaV2Query } from './formulaV2.ts';
import {
    addGroupingFieldsToColumns,
    addSummaryFieldsToColumns,
    formatGroupedResponse,
    formatSummaryResponse,
    removeGroupedHiddenFields,
} from './grouping.ts';
import { collectFormulaWarnings } from './formulaWarnings.ts';
import { withFormulaExecutionBoundary } from './formulaExecutionErrors.ts';
import type { QueryFormat, SelectColumns, SelectQueryOptions } from './queryBuilder.ts';

type TableQueryConfig = Omit<
    SelectQueryOptions,
    'columns' | 'databaseSchema' | 'formulaCalls' | 'formulaInputs' | 'format'
> & {
    columns?: unknown;
    groupBy?: unknown;
    summaries?: unknown;
    cursor?: unknown;
    groupingContext?: unknown;
    fetchGroupedRows?: boolean;
};

type TableQueryContext = Record<string, unknown> & {
    parameters?: Record<string, unknown>;
    auth?: { user?: unknown; isAuthenticated?: boolean };
};

type TableQueryExecutionInput = {
    config: TableQueryConfig;
    context: TableQueryContext;
    env?: string;
    formulaColumnsConfig?: Parameters<typeof prepareFormulaColumns>[1];
    tableFormulaColumns?: unknown;
    includeFormulaPreviewRow?: boolean;
    isolateFormulaErrors?: boolean;
    format?: QueryFormat;
    includeNextOffset?: boolean;
};

export async function executeTableQuery({
    config,
    context,
    env,
    formulaColumnsConfig,
    tableFormulaColumns,
    includeFormulaPreviewRow = false,
    isolateFormulaErrors = false,
    format,
    includeNextOffset = false,
}: TableQueryExecutionInput) {
    const schema = config.schema || 'public';
    const columns = config.columns as SelectColumns | undefined;
    const isGrouped = Array.isArray(config.groupBy) && config.groupBy.length > 0;
    const hasSummaries = Array.isArray(config.summaries) && config.summaries.length > 0;
    const groupingSelection = isGrouped
        ? addGroupingFieldsToColumns(columns, config.groupBy, config.summaries, config.sort)
        : hasSummaries
          ? addSummaryFieldsToColumns(columns, config.summaries)
          : { columns, hiddenFields: [] };
    const { hasFormulaColumns, materializedColumns, normalizedColumns } = prepareFormulaColumns(
        groupingSelection.columns,
        formulaColumnsConfig,
        {
            schema,
            table: config.table,
            includes: config.includes,
        }
    );
    const databaseSchema =
        databaseSchemaService.hasFilterValues(config.filters) ||
        databaseSchemaService.hasIncludeFilterValues(config.includes) ||
        databaseSchemaService.hasIgnoreCaseSort(config.sort, config.includes) ||
        isGrouped ||
        hasSummaries
            ? await databaseSchemaService.getDatabaseSchema(
                  env,
                  context as Parameters<typeof databaseSchemaService.getDatabaseSchema>[1]
              )
            : null;
    const formulaV2Query = prepareFormulaV2Query({
        schema,
        table: config.table,
        columns: materializedColumns,
        filters: config.filters,
        sort: config.sort,
        includes: config.includes,
        tableFormulaColumns,
        parameters: context.parameters,
        env,
        auth: context.auth,
    });
    const hasFormulaV2 = formulaV2Query.calls.length > 0;

    if (isGrouped) {
        const groupedQuery = databaseService.getGroupedQuery({
            schema,
            table: config.table,
            columns: formulaV2Query.columns,
            filters: config.filters,
            sort: config.sort,
            limit: config.limit || 50,
            offset: config.offset || 0,
            includes: config.includes,
            databaseSchema,
            formulaCalls: formulaV2Query.calls,
            formulaInputs: formulaV2Query.inputs,
            groupBy: config.groupBy,
            summaries: config.summaries,
            cursor: config.cursor,
            groupingContext: config.groupingContext,
            fetchGroupedRows: config.fetchGroupedRows,
            hiddenFields: groupingSelection.hiddenFields,
        });
        const rawResult = await withFormulaExecutionBoundary(formulaV2Query.calls, () =>
            databaseService.execute({ ...groupedQuery, env })
        );
        const shouldApplyFormulaColumns = groupedQuery.kind === 'rows' && hasFormulaColumns;
        const groupedResponse = formatGroupedResponse(groupedQuery, rawResult, {
            preserveHiddenFields: shouldApplyFormulaColumns,
        });
        if (shouldApplyFormulaColumns) {
            const materializedRows = applyFormulaColumns(
                groupedResponse.rows,
                normalizedColumns,
                context,
                formulaV2Query.calls
            ) as Record<string, unknown>[];
            groupedResponse.rows = removeGroupedHiddenFields(materializedRows, groupingSelection.hiddenFields);
        }
        return groupedResponse;
    }

    const formulaWarnings = collectFormulaWarnings(formulaV2Query.calls);
    const queryFormat = format ? { format } : {};
    const selectQuery = databaseService.getSelectQuery({
        schema,
        table: config.table,
        columns: formulaV2Query.columns,
        filters: config.filters,
        sort: config.sort,
        limit: config.limit,
        offset: config.offset,
        includes: config.includes,
        databaseSchema,
        formulaCalls: formulaV2Query.calls,
        formulaInputs: formulaV2Query.inputs,
        isolateFormulaErrors,
        ...queryFormat,
    });
    const previewQuery =
        includeFormulaPreviewRow && !hasFormulaColumns && !hasFormulaV2
            ? databaseService.getSelectQuery({
                  schema,
                  table: config.table,
                  columns: getFormulaPreviewColumns(config.columns) as SelectColumns,
                  filters: config.filters,
                  sort: config.sort,
                  limit: 1,
                  offset: config.offset,
                  includes: config.includes,
                  databaseSchema,
                  ...queryFormat,
              })
            : null;
    const countQuery = databaseService.getCountQuery({
        schema,
        table: config.table,
        filters: config.filters,
        includes: config.includes,
        databaseSchema,
        formulaCalls: formulaV2Query.calls,
        formulaInputs: formulaV2Query.inputs,
    });
    const summaryQuery = hasSummaries
        ? databaseService.getSummaryQuery({
              schema,
              table: config.table,
              columns: formulaV2Query.columns,
              filters: config.filters,
              includes: config.includes,
              databaseSchema,
              formulaCalls: formulaV2Query.calls,
              formulaInputs: formulaV2Query.inputs,
              summaries: config.summaries,
          })
        : null;

    const [result, countResult, previewResult, summaryResult] = await withFormulaExecutionBoundary(
        formulaV2Query.calls,
        () =>
            Promise.all([
                databaseService.execute({
                    ...selectQuery,
                    env,
                    ...(isolateFormulaErrors ? { onNotice: formulaWarnings.onNotice } : {}),
                }),
                databaseService.execute({ ...countQuery, env }),
                previewQuery ? databaseService.execute({ ...previewQuery, env }) : null,
                summaryQuery ? databaseService.execute({ ...summaryQuery, env }) : null,
            ])
    );
    const materializedData = (
        hasFormulaColumns ? applyFormulaColumns(result, normalizedColumns, context, formulaV2Query.calls) : result
    ) as Record<string, unknown>[];
    const data = removeGroupedHiddenFields(materializedData, groupingSelection.hiddenFields);
    const total = parseInt(countResult[0].count);
    const offset = typeof config.offset === 'string' ? Number.parseInt(config.offset, 10) || 0 : config.offset || 0;
    const nextOffset = offset + result.length;

    return {
        data,
        metadata: {
            limit: config.limit,
            offset,
            ...(includeNextOffset ? { nextOffset: nextOffset >= total ? null : nextOffset } : {}),
            total,
            ...(formulaWarnings.errors.length
                ? { formulaErrors: formulaWarnings.errors, formulaErrorsTruncated: formulaWarnings.truncated }
                : {}),
            summaries: summaryQuery ? formatSummaryResponse(summaryQuery, summaryResult) : {},
        },
        ...(includeFormulaPreviewRow
            ? {
                  formulaPreviewRow: getFormulaPreviewRow({
                      includeFormulaPreviewRow,
                      hasFormulaColumns: hasFormulaColumns || hasFormulaV2,
                      materializedRows: result,
                      previewRows: previewResult,
                      dataRows: materializedData,
                  }),
              }
            : {}),
    };
}
