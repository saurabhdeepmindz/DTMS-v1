type FrontWorkflowLike = {
    version?: number;
    [key: string]: unknown;
};

type FrontWorkflowCapabilities = {
    throwOnConfigFormulaError: boolean;
};

export const FRONT_WORKFLOW_VERSIONS = Object.freeze({
    LEGACY: 1,
    FORMULA_ERRORS_FAIL: 2,
});

export const FRONT_WORKFLOW_CAPABILITIES = Object.freeze<Record<number, FrontWorkflowCapabilities>>({
    [FRONT_WORKFLOW_VERSIONS.LEGACY]: Object.freeze({
        throwOnConfigFormulaError: false,
    }),
    [FRONT_WORKFLOW_VERSIONS.FORMULA_ERRORS_FAIL]: Object.freeze({
        throwOnConfigFormulaError: true,
    }),
});

export const LATEST_FRONT_WORKFLOW_VERSION = Math.max(...Object.keys(FRONT_WORKFLOW_CAPABILITIES).map(Number));

const KNOWN_FRONT_WORKFLOW_VERSIONS = Object.freeze(
    Object.keys(FRONT_WORKFLOW_CAPABILITIES)
        .map(Number)
        .sort((a, b) => a - b)
);

export function getFrontWorkflowVersion(workflow?: FrontWorkflowLike) {
    const version = Number(workflow?.version);
    if (!Number.isInteger(version) || version < FRONT_WORKFLOW_VERSIONS.LEGACY) {
        return FRONT_WORKFLOW_VERSIONS.LEGACY;
    }

    return version;
}

export function resolveFrontWorkflowVersion(version?: number) {
    const normalizedVersion = getFrontWorkflowVersion({ version });
    let resolvedVersion: number = FRONT_WORKFLOW_VERSIONS.LEGACY;

    for (const knownVersion of KNOWN_FRONT_WORKFLOW_VERSIONS) {
        if (knownVersion > normalizedVersion) break;
        resolvedVersion = knownVersion;
    }

    return resolvedVersion;
}

export function getFrontWorkflowCapabilities(workflow?: FrontWorkflowLike) {
    return FRONT_WORKFLOW_CAPABILITIES[resolveFrontWorkflowVersion(getFrontWorkflowVersion(workflow))];
}

export function withLatestFrontWorkflowVersion<T extends Record<string, unknown>>(workflow: T = {} as T) {
    return {
        ...workflow,
        version: LATEST_FRONT_WORKFLOW_VERSION,
    };
}

export function preserveFrontWorkflowVersion<
    TWorkflow extends FrontWorkflowLike | null | undefined,
    TPreviousWorkflow extends FrontWorkflowLike | null | undefined,
>(workflow: TWorkflow, previousWorkflow: TPreviousWorkflow) {
    if (!workflow || workflow.version !== undefined || previousWorkflow?.version === undefined) {
        return workflow;
    }

    return {
        ...workflow,
        version: previousWorkflow.version,
    };
}
