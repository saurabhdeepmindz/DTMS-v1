import { getApiBase, getApiHeaders, buildQueryString, clampLimit } from './n8n.utils.ts';

// Filters each resource accepts. Used to reject a filter that belongs to a different resource.
const RESOURCE_FILTERS: Record<string, string[]> = {
    executions: ['workflowId', 'status'],
};

global.registerTableView('n8n', async (connection: ConnectionConfig, table: TableConfig, view: ViewConfig) => {
    // Single-resource table (executions) — table.resource may be absent.
    const resource = table.resource || 'executions';
    const allowedFilters = RESOURCE_FILTERS[resource];
    if (!allowedFilters) {
        throw {
            status: 400,
            message: `Invalid n8n table resource "${resource}". Valid resources are: ${Object.keys(RESOURCE_FILTERS).join(', ')}.`,
        };
    }

    // Reject only filters belonging to a *different* resource — the fetch path injects extra
    // view keys (formulaColumns, pagination) that must be ignored, never rejected.
    const foreignFilters = Object.values(RESOURCE_FILTERS)
        .flat()
        .filter(key => !allowedFilters.includes(key));
    const viewKeys = view as Record<string, any>;
    const invalidFilters = Object.keys(viewKeys).filter(
        key =>
            foreignFilters.includes(key) &&
            viewKeys[key] !== undefined &&
            viewKeys[key] !== null &&
            viewKeys[key] !== ''
    );
    if (invalidFilters.length) {
        throw {
            status: 400,
            message:
                `Invalid filter(s) for n8n "${resource}" resource: ${invalidFilters.join(', ')}. ` +
                `Valid filters are: ${allowedFilters.join(', ')}.`,
        };
    }

    const limit = clampLimit(view.limit) ?? 50;

    // n8n cursors are opaque strings: view.offset carries the previous page's nextOffset, and
    // 0/'0'/'' means first page. A numeric offset > 0 has no cursor equivalent — reject it
    // rather than silently returning page 1 (numeric random access: WW-5782).
    const rawOffset = view.offset;
    let cursor: string | undefined;
    const numericOffset =
        typeof rawOffset === 'number'
            ? rawOffset
            : typeof rawOffset === 'string' && /^\d+$/.test(rawOffset)
              ? parseInt(rawOffset, 10)
              : null;
    if (numericOffset !== null && numericOffset > 0) {
        throw {
            status: 400,
            message:
                `n8n executions use cursor pagination — a numeric offset (${numericOffset}) cannot be translated ` +
                `to a cursor. Pass the nextOffset value returned by the previous page (or 0 for the first page).`,
        };
    }
    if (numericOffset === null && typeof rawOffset === 'string' && rawOffset !== '') cursor = rawOffset;

    const params = {
        workflowId: view.workflowId,
        status: view.status,
        limit,
        cursor,
    };

    const response = await fetch(`${getApiBase(connection)}/executions${buildQueryString(params)}`, {
        headers: getApiHeaders(connection),
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) throw { ...data, status: response.status };

    return {
        data: data.data || [],
        metadata: {
            limit,
            offset: cursor || null,
            nextOffset: data.nextCursor || null,
        },
    };
});
