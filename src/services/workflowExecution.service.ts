import workflows from '../data/workflows.json' with { type: 'json' };
import tableFormulaColumns from '../data/tableFormulaColumns.json' with { type: 'json' };
import { getConnections, resolveConnections } from './connection.service.js';
import { parseTableFormulaColumns } from '../schemas/tableFormulaColumns.ts';
import type { TableFormulaColumn } from '../schemas/tableFormulaColumns.ts';

export interface WorkflowExecutionData {
    workflows: any[];
    connections: Record<string, any>;
    tableFormulaColumns: TableFormulaColumn[];
}

export const packagedExecutionData: WorkflowExecutionData = {
    workflows,
    // Read when a run starts: the editor's live connections when it serves them (WW-6021), the packaged ones otherwise.
    get connections() {
        return getConnections();
    },
    tableFormulaColumns: parseTableFormulaColumns(tableFormulaColumns),
};

/** Every entry point supplies a complete catalog, then adds its own auth, event or job context. */
export function prepareWorkflowExecution(data: WorkflowExecutionData = packagedExecutionData) {
    if (!Array.isArray(data.tableFormulaColumns)) {
        throw new Error('Workflow execution data is missing the formula catalog');
    }

    return {
        workflows: data.workflows,
        connections: resolveConnections(structuredClone(data.connections)),
        tableFormulaColumns: data.tableFormulaColumns,
    };
}
