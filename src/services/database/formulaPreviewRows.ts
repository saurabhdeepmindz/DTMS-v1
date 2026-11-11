import { isPlainObject } from '../../utils/objectGuards.ts';

function createConfigFromArray(columns: unknown[]): Record<string, true> {
    const config: Record<string, true> = { '*': true };
    for (const column of columns) {
        if (typeof column === 'string') config[column] = true;
    }
    return config;
}

function getFormulaPreviewColumns(columns: unknown): unknown {
    if (columns === '*') return '*';
    if (Array.isArray(columns)) return createConfigFromArray(columns);
    if (!isPlainObject(columns)) return '*';

    return {
        ...columns,
        '*': true,
    };
}

function getFormulaPreviewRow({
    includeFormulaPreviewRow,
    hasFormulaColumns,
    materializedRows,
    previewRows,
    dataRows,
}: {
    includeFormulaPreviewRow: boolean;
    hasFormulaColumns: boolean;
    materializedRows: unknown;
    previewRows?: unknown;
    dataRows?: unknown;
}): unknown {
    if (!includeFormulaPreviewRow) return undefined;
    if (hasFormulaColumns && Array.isArray(materializedRows)) return materializedRows[0];
    if (Array.isArray(previewRows)) return previewRows[0];
    if (Array.isArray(dataRows)) return dataRows[0];
    return undefined;
}

export { getFormulaPreviewColumns, getFormulaPreviewRow };
