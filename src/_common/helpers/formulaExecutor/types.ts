/**
 * Result returned by formula executors without leaking environment-specific exceptions to callers.
 */
export type FormulaExecutionResult =
    | { status: 'resolved'; value: unknown }
    | {
          status: 'unresolved';
          reason:
              | 'unsupported-type'
              | 'unsupported-feature'
              | 'missing-context'
              | 'invalid-code'
              | 'budget-exceeded'
              | 'executor-unavailable';
      }
    | { status: 'error'; error: unknown };

/**
 * Environment-independent formula execution strategy.
 *
 * Browser and publisher implementations intentionally use different execution engines. The
 * context type makes those environment boundaries explicit while consumers share one result API.
 */
export type FormulaExecutor<TContext = unknown> = {
    execute(formula: unknown, context: TContext): FormulaExecutionResult;
};

/**
 * Minimal formula payload understood by the shared executor contract.
 */
export type FormulaValue = {
    __wwtype?: unknown;
    type?: unknown;
    code?: unknown;
    staticValue?: unknown;
    filter?: unknown;
    sort?: unknown;
    __wwmap?: unknown;
};
