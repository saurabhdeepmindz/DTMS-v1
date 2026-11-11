import { ApiClient } from '@mondaydotcomorg/api';

// Schema introspected against this version (change_item_name removed, limit non-null on
// items_page/next_items_page) — bump deliberately, not implicitly via SDK upgrades.
export const MONDAY_API_VERSION = '2026-07';

export function getMondayClient(connection: ConnectionConfig | undefined) {
    return new ApiClient({ token: connection?.apiToken, apiVersion: MONDAY_API_VERSION });
}

// monday's JSON scalar (column_values, defaults) expects a JSON-encoded
// string; the editor may bind either a string or a plain object.
export function asJsonString(value: unknown): string | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    if (typeof value === 'string') return value;
    return JSON.stringify(value);
}

// The editor emits '' / [] / null for cleared or unbound fields; monday rejects them on
// optional args (e.g. workspace_id: ""). Drop them so the GraphQL variable is omitted.
export function compactVariables<T extends Record<string, any>>(variables: T): T {
    const compacted: Record<string, any> = {};
    for (const [key, value] of Object.entries(variables)) {
        if (value === undefined || value === null || value === '') continue;
        if (Array.isArray(value) && value.length === 0) continue;
        compacted[key] = value;
    }
    return compacted as T;
}

export const BOARD_FIELDS = `
    id
    name
    description
    board_kind
    state
    board_folder_id
    workspace_id
    url
`;

export const ITEM_FIELDS = `
    id
    name
    state
    url
    created_at
    updated_at
    board { id name }
    group { id title }
    column_values { id text value type column { id title } }
`;

export const COLUMN_FIELDS = `
    id
    title
    type
    description
    settings_str
`;

export const GROUP_FIELDS = `
    id
    title
    color
    position
    archived
    deleted
`;

export const UPDATE_FIELDS = `
    id
    body
    text_body
    created_at
    updated_at
    creator_id
    item_id
    replies { id body text_body created_at creator_id }
`;
