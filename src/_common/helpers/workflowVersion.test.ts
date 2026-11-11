import { describe, expect, it } from 'vitest';
import {
    FRONT_WORKFLOW_VERSIONS,
    LATEST_FRONT_WORKFLOW_VERSION,
    getFrontWorkflowCapabilities,
    getFrontWorkflowVersion,
    preserveFrontWorkflowVersion,
    resolveFrontWorkflowVersion,
    withLatestFrontWorkflowVersion,
} from './workflowVersion';

describe('workflowVersion', () => {
    it('treats missing version as legacy v1', () => {
        expect(getFrontWorkflowVersion({})).toBe(FRONT_WORKFLOW_VERSIONS.LEGACY);
        expect(getFrontWorkflowCapabilities({}).throwOnConfigFormulaError).toBe(false);
    });

    it('uses v2 capabilities when version is 2', () => {
        expect(getFrontWorkflowVersion({ version: FRONT_WORKFLOW_VERSIONS.FORMULA_ERRORS_FAIL })).toBe(
            FRONT_WORKFLOW_VERSIONS.FORMULA_ERRORS_FAIL
        );
        expect(
            getFrontWorkflowCapabilities({ version: FRONT_WORKFLOW_VERSIONS.FORMULA_ERRORS_FAIL })
                .throwOnConfigFormulaError
        ).toBe(true);
    });

    it('resolves unknown future versions to the latest known capabilities', () => {
        expect(resolveFrontWorkflowVersion(999)).toBe(LATEST_FRONT_WORKFLOW_VERSION);
        expect(getFrontWorkflowCapabilities({ version: 999 }).throwOnConfigFormulaError).toBe(true);
    });

    it('applies the latest version to new front workflows', () => {
        expect(withLatestFrontWorkflowVersion({ name: 'Test workflow' })).toEqual({
            name: 'Test workflow',
            version: LATEST_FRONT_WORKFLOW_VERSION,
        });
    });

    it('preserves an existing version when the next payload omits it', () => {
        expect(
            preserveFrontWorkflowVersion(
                {
                    id: 'next',
                    name: 'Workflow',
                },
                {
                    id: 'previous',
                    version: FRONT_WORKFLOW_VERSIONS.FORMULA_ERRORS_FAIL,
                }
            )
        ).toEqual({
            id: 'next',
            name: 'Workflow',
            version: FRONT_WORKFLOW_VERSIONS.FORMULA_ERRORS_FAIL,
        });
    });
});
