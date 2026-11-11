export function getHeaders(apiKey: string) {
    return { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
}

export function buildQueryString(params: Record<string, any>) {
    if (!params || Object.keys(params).length === 0) {
        return '';
    }

    const queryParts = Object.entries(params)
        .map(([key, value]) => {
            if (Array.isArray(value)) {
                if (value.length === 0) return '';

                const isObjectItems = typeof value[0] === 'object';

                if (isObjectItems) {
                    // Array of objects - use indexed format
                    return value
                        .map((obj, index) =>
                            Object.entries(obj)
                                .map(
                                    ([objKey, objValue]) =>
                                        `${key}[${index}][${objKey}]=${encodeURIComponent(`${objValue}`)}`
                                )
                                .join('&')
                        )
                        .join('&');
                } else {
                    // Array of primitives (strings, numbers, etc.) - use brackets format
                    return value.map(item => `${key}[]=${encodeURIComponent(item)}`).join('&');
                }
            }
            return params[key] ? `${key}=${encodeURIComponent(value)}` : null;
        })
        .filter(Boolean)
        .join('&');

    return queryParts ? `?${queryParts}` : '';
}

export function processAirtableSingleFields(actionFields = {}, tableLinkData = {}, allowedFields = []) {
    const fields: Record<string, unknown> = {};

    if (tableLinkData) {
        for (const [key, value] of Object.entries(tableLinkData)) {
            if (!allowedFields.length || allowedFields.includes(key)) {
                fields[key] = value;
            }
        }
    }

    for (const [key, value] of Object.entries(actionFields)) {
        if (value !== undefined && value !== null && value !== '') {
            if (!allowedFields.length || allowedFields.includes(key)) {
                fields[key] = value;
            }
        } else if (!(key in fields)) {
            if (!allowedFields.length || allowedFields.includes(key)) {
                fields[key] = value;
            }
        }
    }

    return fields;
}

export function processAirtableData(actionData = [], tableLinkData = {}, allowedFields = []) {
    return actionData.map(item => {
        if (typeof item === 'object' && item !== null) {
            const processedItem: Record<string, unknown> = {};

            if (tableLinkData) {
                for (const [key, value] of Object.entries(tableLinkData)) {
                    if (!allowedFields.length || allowedFields.includes(key)) {
                        processedItem[key] = value;
                    }
                }
            }

            for (const [key, value] of Object.entries(item as Record<string, unknown>)) {
                if (value !== undefined && value !== null && value !== '') {
                    if (!allowedFields.length || allowedFields.includes(key)) {
                        processedItem[key] = value;
                    }
                } else if (!(key in processedItem)) {
                    if (!allowedFields.length || allowedFields.includes(key)) {
                        processedItem[key] = value;
                    }
                }
            }

            return processedItem;
        }
        return item;
    });
}
