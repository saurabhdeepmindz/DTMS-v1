import { API_BASE, getHeaders, getBusinessAccountId, buildQueryString, clampLimit } from './whatsapp.utils.ts';

const RESOURCES_AVAILABLE = ['templates'];

global.registerTableView('whatsapp', async (connection: ConnectionConfig, table: TableConfig, view: ViewConfig) => {
    // Single-resource table (templates) — table.resource may be absent.
    const resource = table.resource || 'templates';
    if (!RESOURCES_AVAILABLE.includes(resource)) {
        throw {
            status: 400,
            message: `Invalid WhatsApp table resource "${resource}". Valid resources are: ${RESOURCES_AVAILABLE.join(', ')}.`,
        };
    }

    const limit = clampLimit(view.limit) ?? 25;

    // Graph cursors are opaque strings: view.offset carries the previous page's nextOffset, and
    // 0/'0'/'' means first page. A numeric offset > 0 has no cursor equivalent — reject it
    // rather than silently returning page 1.
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
                `WhatsApp templates use cursor pagination — a numeric offset (${numericOffset}) cannot be translated ` +
                `to a cursor. Pass the nextOffset value returned by the previous page (or 0 for the first page).`,
        };
    }
    if (numericOffset === null && rawOffset) cursor = String(rawOffset);

    const params = {
        fields: 'id,name,category,language,status,components',
        limit,
        after: cursor,
        status: view.status,
        category: view.category,
        language: view.language,
        name_or_content: view.nameOrContent,
    };

    const headers = getHeaders(connection);
    const response = await fetch(
        `${API_BASE}/${encodeURIComponent(getBusinessAccountId(connection))}/message_templates${buildQueryString(params)}`,
        { headers }
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw data;

    return {
        data: data.data || [],
        metadata: {
            limit,
            offset: cursor || null,
            // Graph returns cursors.after even on the last page — paging.next is the real "has more" signal.
            nextOffset: data.paging?.next ? data.paging?.cursors?.after || null : null,
        },
    };
});
